// 单位：美元 / 100 万 token。取的是 paid tier 的名义价——
// 实际走 Gemini 免费额度时并不会真的扣费，这里算的是"如果按量付费值多少钱"。
//
// 来源：https://ai.google.dev/gemini-api/docs/pricing（2026-07-30 核对）
// ⚠️ 必须和 hooks/useChat.ts 的 models 数组保持同步。少一个条目不会报错，
// calcCost 会走 `if (!price) return 0` 静默算成 0 —— 这种缺口很难被发现。
const PRICING: Record<string, { input: number; output: number }> = {
  // Gemini（全部有免费层）
  "gemini-3.6-flash": { input: 1.5, output: 7.5 },
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3-flash-preview": { input: 0.5, output: 3.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  // OpenAI（付费）
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export function calcCost(args: {
  inputTokens: number;
  outputTokens: number;
  model: string;
}) {
  const price = PRICING[args.model];
  if (!price) return 0;
  const inputPrice = (args.inputTokens / 1_000_000) * price.input;
  const outputPrice = (args.outputTokens / 1_000_000) * price.output;
  const totalPrice = inputPrice + outputPrice;

  return totalPrice;
}
