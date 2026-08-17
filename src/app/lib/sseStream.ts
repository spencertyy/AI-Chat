// 把一段**已经拿到的完整文本**回放成 SSE 流。
//
// 两处在用，需求一模一样，所以抽出来共用：
//   ① demoResponse —— 配额耗尽时回放预录文本
//   ② chat-stream 的军师人格 —— 服务端先缓冲完整输出、跑完 personaGuard 校验，
//      通过之后再回放给前端
//
// 这个做法叫 **buffer-then-replay（先缓冲再回放）**，也叫伪流式。它把「流式」
// 拆成了本来被捆在一起的两件事：**真流式**（边生成边发，首字快）和**打字动画**
// （逐字显示，观感）。先缓冲会丢掉前者、保留后者。
//
// 为什么这个取舍成立：校验必须拿到完整输出才能做，而校验又必须在服务端
// （客户端校验拦不住直接打 API 的人）。军师输出只有 60–90 tokens，损失的
// 首字延迟很小；换来的是前端一行代码都不用改——帧结构与真流式逐字节一致。

const encoder = new TextEncoder();

/** 把一个对象包成一帧 SSE 数据 */
export function sseFrame(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

/** 结束帧。前端靠它判断流正常走完，而不是靠连接关闭 */
export function sseDone(): Uint8Array {
  return encoder.encode("data: [DONE]\n\n");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ReplayOptions = {
  /** 每帧吐几个字符 */
  chunkSize?: number;
  /** 帧间隔毫秒 */
  delayMs?: number;
};

/**
 * 逐帧回放文本。默认节奏（3 字符 / 18ms）取自 demoResponse 原有的实现：
 * 真实模型按 token 吐，节奏本来就不均匀，这是一个视觉上接近的近似值。
 *
 * 军师人格用更快的节奏——它前面已经花了约 2 秒生成，再慢慢播就太久了。
 */
export async function replayText(
  controller: ReadableStreamDefaultController<Uint8Array>,
  text: string,
  { chunkSize = 3, delayMs = 18 }: ReplayOptions = {},
): Promise<void> {
  for (let i = 0; i < text.length; i += chunkSize) {
    controller.enqueue(sseFrame({ text: text.slice(i, i + chunkSize) }));
    await sleep(delayMs);
  }
}

/**
 * 军师人格的回放节奏，比默认快得多。
 *
 * 实测一次完整请求是「生成 4.2s + 回放 1.1s」。生成那段压不动（模型确实要
 * 那么久），但回放节奏是我们自己定的——用户已经等了 4 秒，再慢悠悠播一秒
 * 纯属雪上加霜。约 320 字符按这个节奏约 0.4 秒播完，打字观感还在，
 * 总时长省下约 0.7 秒。
 */
export const ADVISOR_REPLAY: ReplayOptions = { chunkSize: 6, delayMs: 8 };
