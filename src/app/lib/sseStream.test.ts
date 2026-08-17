/** @jest-environment node */
// ReadableStream 是 Web Streams API，jsdom 不提供，Node 环境才有。
// 与 messages route 的测试用同一个办法（逐文件 docblock 覆盖环境）。

import { sseFrame, sseDone, replayText } from "./sseStream";
import { streamDemoResponse, buildDemoResponse } from "./demoResponse";

const decoder = new TextDecoder();

/** 把整条流读完，返回解析后的帧数组和原始文本 */
async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value);
  }
  const payloads = raw
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length));
  return { raw, payloads };
}

describe("sseFrame / sseDone", () => {
  // SSE 的帧分隔是**两个换行**。少一个的话浏览器的 EventSource 和我们
  // useChat 里的手写解析都会把相邻两帧粘成一帧。
  it("wraps data in a well-formed SSE frame", () => {
    expect(decoder.decode(sseFrame({ text: "hi" }))).toBe(
      'data: {"text":"hi"}\n\n',
    );
  });

  it("emits the terminator frame", () => {
    expect(decoder.decode(sseDone())).toBe("data: [DONE]\n\n");
  });
});

describe("replayText", () => {
  it("slices text into frames that reassemble to the original", async () => {
    const text = "abcdefghij";
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // delayMs: 0 —— 这里测的是切片与重组，不是节奏
        await replayText(controller, text, { chunkSize: 3, delayMs: 0 });
        controller.close();
      },
    });

    const { payloads } = await drain(stream);
    expect(payloads).toHaveLength(4); // 3 + 3 + 3 + 1
    expect(payloads.map((p) => JSON.parse(p).text).join("")).toBe(text);
  });

  // 回放的文本里可能有引号、换行、反斜杠（demoResponse 就带 markdown 和代码块）。
  // 每帧都走 JSON.stringify，所以这些字符必须能原样还原——
  // 少一层转义就会让前端 JSON.parse 崩在半个帧上。
  it("survives quotes, newlines and backslashes", async () => {
    const text = 'a "b"\nc\\d';
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await replayText(controller, text, { chunkSize: 2, delayMs: 0 });
        controller.close();
      },
    });
    const { payloads } = await drain(stream);
    expect(payloads.map((p) => JSON.parse(p).text).join("")).toBe(text);
  });
});

describe("streamDemoResponse", () => {
  // 真实节奏是 3 字符 / 18ms，整段约 1600 字符要跑 9 秒多，超过 jest 默认超时。
  // 用假定时器把等待折叠掉：测的是帧序列，不是真实耗时。
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("emits degraded frame, the full body, then DONE", async () => {
    const stream = streamDemoResponse("ip");
    const pending = drain(stream);
    await jest.runAllTimersAsync();
    const { raw, payloads } = await pending;

    // 首帧声明降级原因，前端据此显示 badge
    expect(JSON.parse(payloads[0])).toEqual({ type: "degraded", reason: "ip" });
    expect(raw.trimEnd().endsWith("data: [DONE]")).toBe(true);

    const body = payloads
      .filter((p) => p !== "[DONE]")
      .map((p) => JSON.parse(p))
      .filter((d) => typeof d.text === "string")
      .map((d) => d.text)
      .join("");
    expect(body).toBe(buildDemoResponse());
  });

  // 这次没有调用任何模型，就不该报告 token 数。前端在 usage 缺失时
  // 本来就不显示用量，行为是对的。
  it("does not report usage", async () => {
    const stream = streamDemoResponse("global");
    const pending = drain(stream);
    await jest.runAllTimersAsync();
    const { payloads } = await pending;

    const hasUsage = payloads
      .filter((p) => p !== "[DONE]")
      .some((p) => JSON.parse(p).type === "usage");
    expect(hasUsage).toBe(false);
  });
});
