// 公开 demo 配额耗尽时的降级回复。
//
// 设计目标不是"告诉用户出错了"，而是"让访客仍然看到这个产品的能力"。
// 所以内容刻意包含标题、正文、表格、代码块——它们会经过 MarkDownRenderer
// 和 CodeBlock，把 GFM 渲染、语法高亮、语言徽章、复制按钮全部展示一遍。
// 配额用完时看到的东西，反而比一次随机的模型回答展示得更完整。
//
// 输出格式和真实模型响应逐字节一致（同样的 SSE 帧结构），所以前端
// 不需要任何改动，也无从分辨对面是模型还是预录文本。

import { sseFrame, sseDone, replayText } from "./sseStream";

export type DegradeReason = "ip" | "global";

// 正文里的提示和界面上的 badge 分工不同，不是重复：
//   badge（MessageList）说「为什么」——额度用尽、何时恢复；只在当次会话内有效
//   这里的 blockquote 说「这是什么」——预录内容；它属于 content，会随消息一起
//   落库，所以刷新之后历史记录里仍然看得出这条不是模型生成的
//
// 不按 reason 区分：访客并不关心历史上是哪一层限流拦的，那是运维视角。
const NOTICE = "> **Demo mode** — the response below is pre-recorded.\n\n";

// 用英文：产品的其余文案（错误提示、按钮、README）全部是英文，
// 目标读者也是英文使用者。这段内容会被访客直接读到，必须一致。
const BODY = `## About this project

I'm running on a self-built AI chat application. The interesting part isn't
wiring up a model API — that's the easy bit — it's the design system and the
accessibility work underneath it.

### Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| Streaming | Server-Sent Events |
| Styling | Plain CSS variables, 155 tokens |
| Testing | Jest + RTL, Storybook 10 |

### Three specific decisions

**The fluid type scale mixes \`rem\` into the \`vw\` term** instead of using \`vw\` alone:

\`\`\`css
--font-size-display: clamp(2rem, 1.5rem + 2vw, 3.5rem);
\`\`\`

A pure \`vw\` value ignores the reader's browser font-size setting entirely,
which fails WCAG 1.4.4.

**Reduced motion collapses to \`0.01ms\`, not \`none\`** — setting \`none\` stops
\`transitionend\` from ever firing, silently breaking any logic that waits on it.

**Contrast is measured against the composited background**, not the token's
declared value. Translucent layers mean those two are rarely the same color.

---

This text is itself demonstrating streaming output, Markdown rendering, and
syntax highlighting.`;

/** 拼出完整的降级回复文本（提示 + 正文）。 */
export function buildDemoResponse(): string {
  return NOTICE + BODY;
}

// 逐帧回放的实现已抽到 lib/sseStream.ts —— 军师人格的「先缓冲再回放」
// 需要一模一样的能力（那边是先跑完 personaGuard 校验再放行）。默认节奏
// （3 字符 / 18ms，整段约 4 秒）就是从这里搬过去的，行为不变。

/**
 * 把降级回复包装成与真实响应同构的 SSE 流。
 *
 * 帧序列刻意和 chat-stream 的 Gemini 分支保持一致：
 *   data: {"type":"degraded","reason":"..."}   ← 仅此一帧是新增的
 *   data: {"text":"..."}                        ← 正文，多帧
 *   data: [DONE]
 *
 * 不发 usage 帧：这次没有调用任何模型，就不该报告 token 数。
 * 前端在 usage 缺失时本来就不显示用量，行为是对的。
 *
 * degraded 帧对旧前端是安全的——解析时走 `parsed.text ?? ""`，
 * 没有 text 字段就追加空串，不认识它也不会出错。
 */
export function streamDemoResponse(
  reason: DegradeReason,
): ReadableStream<Uint8Array> {
  const text = buildDemoResponse();

  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(sseFrame({ type: "degraded", reason }));
        await replayText(controller, text);
        controller.enqueue(sseDone());
        controller.close();
      } catch (error) {
        // 访客中途关掉页面时，往已断开的流里写会抛错。这不是故障，
        // 静默收尾即可——控制器可能已经关了，close 也要保护起来。
        console.error("Demo stream aborted:", error);
        try {
          controller.close();
        } catch {}
      }
    },
  });
}
