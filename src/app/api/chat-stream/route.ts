import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  checkDemoQuota,
  getClientIp,
  cleanupExpired,
} from "@/app/lib/rateLimit";
import { streamDemoResponse } from "@/app/lib/demoResponse";
import {
  getPersona,
  buildSystemPrompt,
  DEFAULT_PERSONA_ID,
} from "@/app/lib/personas";
import { checkOutput, buildRetryHint } from "@/app/lib/personaGuard";
import {
  sseFrame,
  sseDone,
  replayText,
  ADVISOR_REPLAY,
} from "@/app/lib/sseStream";
import type { Persona } from "@/app/types/chat";

// 公开 demo 模式。只在部署到公网时打开（Vercel 环境变量里设 "true"），
// 本地开发默认关闭，所以下面所有护栏都不会干扰你自己调试。
//
// 用 NEXT_PUBLIC_ 前缀是因为 ModelSelector 也要读它来把 OpenAI 置灰。
// 这个前缀意味着值会被打进浏览器 JS——对一个布尔开关无所谓，它本来
// 就不是秘密。真正的秘密（API key）绝不能带这个前缀。
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

// --- 部署配置 ---
// 流式响应在 Serverless 平台上受函数执行时长限制约束，默认值远低于一次长回答
// 需要的时间——超时后连接被切断，用户看到的是回答说到一半就停了。
// 本地 dev server 没有这个限制，所以这个问题只在线上出现，本地测不出来。
export const maxDuration = 60;

// --- 输入长度护栏 ---
// 必须在服务端校验：前端输入框的限制拦不住直接对 /api/chat-stream 发请求的人。
// input token 也是计费的，不限长度的话一个请求就能塞爆成本。
const MAX_CHARS_PER_MESSAGE = 4000; // 单条上限，约等于贴一段中等长度的代码
const MAX_CHARS_TOTAL = 16000; // 真正拼进 prompt 的总字符数上限

// 把上游错误映射成能直接展示给用户的文案。
//
// 为什么是白名单而不是把上游的 error.message 透出去：上游文案可能带内部细节
// （完整模型路径、配额策略、内部 endpoint 等），原样显示就是信息泄漏。
// 这里只翻译我们确实认识的状态码，其余一律走通用文案，真实原因留在
// console.error 里给开发者看。前端那侧的 UserFacingError 是同一个思路。
//
// 404 这条是实打实踩出来的：gemini-2.5-flash-lite 出现在 models.list 里，
// 但调用返回 404「no longer available to new users」。没有这条特判时，
// 用户只会看到"Something went wrong"，完全不知道该换个模型。
function toUserMessage(provider: "Gemini" | "OpenAI", error: unknown): string {
  const status = (error as { status?: number })?.status;
  if (status === 429) {
    return `${provider} free quota exceeded. Please wait and try again later.`;
  }
  if (status === 404) {
    return `This ${provider} model is no longer available. Please pick a different model from the selector.`;
  }
  return "Something went wrong.";
}

// 一次生成的结果。两个 provider 的 SDK 形状差别很大，先归一成这个类型，
// 下面的校验/重试骨架就不用关心是谁生成的。
type Attempt = { text: string; inputTokens: number; outputTokens: number };

/** 生成一次。extraTurns 用于重试时把"上次答了什么 + 哪里错了"接回上下文 */
type GenerateOnce = (
  extraTurns: { role: "user" | "model"; text: string }[],
) => Promise<Attempt>;

/**
 * 军师人格的响应流：**先缓冲 → 校验 → 必要时重试一次 → 回放**。
 *
 * 为什么不能沿用真流式：personaGuard 需要**完整输出**才能判断，而流式是边生成
 * 边发——等判断完用户早读完了，这时再替换内容体验很怪。而校验又必须在服务端
 * （客户端校验拦不住直接打 API 的人，安全类禁令会形同虚设）。
 *
 * 代价是首字延迟从约 0.5 秒变成约 2.5 秒。军师输出只有 60–90 tokens，这个
 * 损失可以接受；换来的是前端一行都不用改——回放出来的帧和真流式逐字节一致。
 */
function streamCheckedAdvisorReply(
  generateOnce: GenerateOnce,
  persona: Persona,
  providerLabel: "Gemini" | "OpenAI",
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        let attempt = await generateOnce([]);
        let result = checkOutput(attempt.text, persona);

        // token 要跨重试累加：重试也是真实的 API 调用，不计入的话用量统计
        // 会少算，而"某些回答莫名比别的贵"这种账最难查。
        let inputTokens = attempt.inputTokens;
        let outputTokens = attempt.outputTokens;

        if (result.shouldRetry) {
          console.warn(
            `[personaGuard] ${persona.id} attempt 1 rejected:`,
            result.violations.map((v) => v.detail).join("; "),
          );

          // 把上一次的回答和拒绝理由接回上下文，而不是原样再问一遍——
          // 重新采样只是碰运气，把违规点写进上下文才是让它避开同一个坑。
          const retry = await generateOnce([
            { role: "model", text: attempt.text },
            { role: "user", text: buildRetryHint(result.violations) },
          ]);
          inputTokens += retry.inputTokens;
          outputTokens += retry.outputTokens;

          const retryResult = checkOutput(retry.text, persona);
          // 只在重试确实变好时才采纳：偶尔第二次比第一次更差，
          // 那就留着第一次的——重试是为了改进，不是为了换一个。
          if (!retryResult.mustBlock || !result.mustBlock) {
            if (retryResult.violations.length <= result.violations.length) {
              attempt = retry;
              result = retryResult;
            }
          }
        }

        // 重试之后仍然踩到安全红线（劝人删号拉黑）——宁可不回答。
        // 这是唯一一类"宁可给错误提示也不能放行"的违规。
        if (result.mustBlock) {
          console.error(
            `[personaGuard] ${persona.id} blocked after retry:`,
            result.violations.map((v) => v.detail).join("; "),
          );
          controller.enqueue(
            sseFrame({
              error:
                "The reply didn't pass our safety checks. Please try again.",
            }),
          );
          controller.close();
          return;
        }

        // 走到这里说明可以放行。剩下的 warn 级违规（词数超一点）只记日志：
        // 一个措辞略长的回答，好过让用户对着错误提示发呆。
        if (result.violations.length > 0) {
          console.warn(
            `[personaGuard] ${persona.id} passed with warnings:`,
            result.violations.map((v) => v.detail).join("; "),
          );
        }

        await replayText(controller, attempt.text, ADVISOR_REPLAY);
        controller.enqueue(
          sseFrame({ type: "usage", inputTokens, outputTokens }),
        );
        controller.enqueue(sseDone());
        controller.close();
      } catch (error) {
        console.error(`${providerLabel} advisor error:`, error);
        controller.enqueue(
          sseFrame({ error: toUserMessage(providerLabel, error) }),
        );
        try {
          controller.close();
        } catch {}
      }
    },
  });
}

export async function POST(request: Request) {
  const { messages, model, provider, personaId } = await request.json();

  // --- 公开 demo 护栏 ---
  if (DEMO_MODE) {
    // ① OpenAI 是纯付费的，公开 demo 上一律拒绝。
    //    前端会把它置灰，但那只是给正常用户看的礼貌——真正的防线必须在
    //    这里，因为置灰拦不住直接对 /api/chat-stream 发请求的人。
    //    （和下面输入长度护栏是同一个道理。）
    if (provider !== "gemini") {
      return NextResponse.json(
        {
          error:
            "GPT-4o mini is disabled on the public demo to control API cost. Gemini is available — please switch models.",
        },
        { status: 403 },
      );
    }

    // ② 两层限流：每 IP 每小时 + 全站每天。
    //    超限不返回错误，而是流一段预录回复回去——访客仍然能看到完整的
    //    流式输出、Markdown 渲染和代码高亮，而不是撞上一个红色报错。
    const quota = await checkDemoQuota(getClientIp(request.headers));
    if (!quota.allowed) {
      return new Response(streamDemoResponse(quota.reason), {
        headers: SSE_HEADERS,
      });
    }

    // 顺带清理过期窗口：约 1% 的请求触发一次，省得为这点数据单开定时任务。
    // void 表示不等待它完成（fire-and-forget），不拖慢用户的响应。
    if (Math.random() < 0.01) void cleanupExpired();
  }

  const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const openAI = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const MAX_TURNS = 10;
  const recentMessages = messages.slice(-MAX_TURNS * 2); // Get the last 10 turns (user + assistant)

  // 逐条校验 + 累计总长度，任一条超限就立刻拒绝，不进 AI 调用
  let totalChars = 0;
  for (const msg of recentMessages as { content?: string }[]) {
    const len = msg.content?.length ?? 0;
    if (len > MAX_CHARS_PER_MESSAGE) {
      return NextResponse.json(
        {
          error: `Message too long: ${len} characters (limit ${MAX_CHARS_PER_MESSAGE}). Please shorten it.`,
        },
        { status: 400 },
      );
    }
    totalChars += len;
  }
  if (totalChars > MAX_CHARS_TOTAL) {
    return NextResponse.json(
      {
        error: `Conversation too long: ${totalChars} characters (limit ${MAX_CHARS_TOTAL}). Please start a new chat.`,
      },
      { status: 400 },
    );
  }

  // --- 人格解析 ---
  //
  // 只接收 personaId，**绝不接收客户端传来的 prompt 文本**——那等于把 system
  // instruction 的写权限交给任何能发 HTTP 请求的人（prompt injection）。
  // getPersona 走白名单，id 不在表里就查不到，注入不进任何东西。
  //
  // 查不到时回退到默认人格而不是返回 400：一个坏掉的 id 不该让用户看到报错，
  // 但要留 warn 让开发者发现前端传错了，否则会静默降级成"人格没生效"这种
  // 很难查的问题。
  const persona = getPersona(personaId) ?? getPersona(DEFAULT_PERSONA_ID)!;
  if (personaId && persona.id !== personaId) {
    console.warn(
      `Unknown personaId "${personaId}", fell back to ${persona.id}`,
    );
  }
  const systemPrompt = buildSystemPrompt(persona);

  // 对话内容改成**结构化数组**，不再手工拼成 "user: xxx\nmodel: yyy" 的字符串。
  //
  // 两个原因：① system 指令已经搬去 systemInstruction 独立通道了，contents 里
  // 只剩对话，没必要再拼；② 结构化传法让模型明确知道每句话是谁说的，多轮理解
  // 更准——拼成字符串时"谁说的"只是文本里的一个前缀，模型得自己去推断。
  // Gemini 的 role 只认 "user" / "model"，所以 assistant 要映射成 model。
  const contents = recentMessages.map(
    (msg: { role: string; content: string }) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }),
  );

  const encoder = new TextEncoder();

  // --- 军师人格：走「先缓冲 → 校验 → 回放」，不走真流式 ---
  //
  // 通用问答（Straight Up）不进这条路径：它没有三段格式可校验，输出又长，
  // 真流式的首字优势对它是实打实的收益。**两种模式各用各的，不是二选一。**
  if (persona.kind === "advisor") {
    const generateOnce: GenerateOnce =
      provider === "openai"
        ? async (extraTurns) => {
            const res = await openAI.chat.completions.create({
              model,
              messages: [
                { role: "system" as const, content: systemPrompt },
                ...recentMessages,
                ...extraTurns.map((t) => ({
                  // OpenAI 用 assistant 表示模型侧，Gemini 用 model——
                  // 同一个概念两家叫法不同，归一化在各自的适配处做。
                  role: (t.role === "model" ? "assistant" : "user") as
                    "assistant" | "user",
                  content: t.text,
                })),
              ],
              max_completion_tokens: 512,
            });
            return {
              text: res.choices[0]?.message?.content ?? "",
              inputTokens: res.usage?.prompt_tokens ?? 0,
              outputTokens: res.usage?.completion_tokens ?? 0,
            };
          }
        : async (extraTurns) => {
            const res = await genAI.models.generateContent({
              model,
              contents: [
                ...contents,
                ...extraTurns.map((t) => ({
                  role: t.role,
                  parts: [{ text: t.text }],
                })),
              ],
              config: {
                systemInstruction: systemPrompt,
                temperature: 0.7,
                // 军师输出是三段短句，150 已有充足余量（实测峰值 87）。
                // 比通用问答的 1500 收紧一个数量级，重试的成本也因此可控。
                maxOutputTokens: 150,
              },
            });
            return {
              text: res.text ?? "",
              inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
              outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
            };
          };

    return new Response(
      streamCheckedAdvisorReply(
        generateOnce,
        persona,
        provider === "openai" ? "OpenAI" : "Gemini",
      ),
      { headers: SSE_HEADERS },
    );
  }

  if (provider === "gemini") {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await genAI.models.generateContentStream({
            model: model,
            contents,
            config: {
              // 人格走 systemInstruction 这个独立通道，不再拼进 contents。
              // 拼进 contents 时模型把它当普通对话内容看待，用户输入里的
              // "忽略上面所有规则"和它处在同一层级，有机会盖过去
              // （prompt injection）；systemInstruction 权重更高，更难被覆盖。
              systemInstruction: systemPrompt,
              temperature: 0.7,
              maxOutputTokens: 1500, //token control
            },
          });
          let usageMetadata: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
          } | null = null;
          for await (const chunk of result) {
            const text = chunk.text ?? "";
            if (text) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
              ); //把 Gemini 的 chunk 包成 SSE（ server-sent events）格式。
            }
            if (chunk.usageMetadata) {
              usageMetadata = chunk.usageMetadata; // ← 每次更新，最后一个最完整
            }
          }

          // 循环结束后发送 usage
          if (usageMetadata) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "usage",
                  inputTokens: usageMetadata.promptTokenCount ?? 0,
                  outputTokens: usageMetadata.candidatesTokenCount ?? 0,
                })}\n\n`,
              ),
            );
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          console.error("Gemini streaming error:", error);

          const message = toUserMessage("Gemini", error);

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: message,
              })}\n\n`,
            ),
          );
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
  if (provider === "openai") {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await openAI.chat.completions.create({
            model: model,
            // 这里以前只传 recentMessages，**没有任何 system 指令**——所以那段
            // markdown/表格规则一直只对 Gemini 生效，切到 GPT 就换了行为。
            // 现在两个 provider 共用同一份 systemPrompt，人格与格式规则一致。
            messages: [
              { role: "system" as const, content: systemPrompt },
              ...recentMessages,
            ],
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: 512, // 成本上限：OpenAI 是付费 key，output 每 token 都是真钱
          });

          for await (const chunk of result) {
            const text = chunk.choices[0]?.delta?.content ?? "";
            if (text) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
              );
            }
            if (chunk.usage) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "usage",
                    inputTokens: chunk.usage.prompt_tokens,
                    outputTokens: chunk.usage.completion_tokens,
                  })}\n\n`,
                ),
              );
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          console.error("OpenAI streaming error:", error);
          const message = toUserMessage("OpenAI", error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: message,
              })}\n\n`,
            ),
          );
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
}
