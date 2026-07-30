import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { NextResponse } from "next/server";

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

export async function POST(request: Request) {
  const { messages, model, provider } = await request.json();

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

  const conversation = recentMessages
    .map((msg: { role: string; content: string }) => {
      const speaker = msg.role === "assistant" ? "model" : "user";
      return `${speaker}: ${msg.content}`;
    })
    .join("\n");

  const prompt = [
    `You are a helpful AI assistant,
  Rules:
  - Answer the question based on the conversation history.
  - Keep reponses short and to the point.
  - Prefer bullet points if the answer is long.
  - Avoid unnecessary explanations.
  - If the user asks for a table, output a real GitHub-Flavored Markdown table.
  - Never put markdown tables inside code blocks.
  - Do not use triple backticks around tables.
  - Only use code blocks for actual code examples.
  Conversation:
  ${conversation}
  Assistant:`,
  ].join("\n");

  const encoder = new TextEncoder();

  if (provider === "gemini") {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await genAI.models.generateContentStream({
            model: model,
            contents: prompt,
            config: {
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
            messages: recentMessages,
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
