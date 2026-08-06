import { calcCost } from "./pricing";

export type UsageSummary = {
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

// 聚合的输入形状刻意放宽成这个最小集合，好让两条数据源共用同一份计价逻辑：
//   · 登录用户 → Prisma groupBy 的结果行（服务端）
//   · 游客     → localStorage 里的 Message 列表（浏览器端）
// 三个字段全可空是因为：老数据里 model 为 null（model 字段是后加的），
// user 消息本来就没有 token，Prisma 的 _sum 在无匹配行时也返回 null。
type UsageRow = {
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

// token 可以直接加总，费用不行——每个模型单价不同，
// 必须按模型分别计价再相加。model 为 null 的老数据算不出价，
// 只计入 token 总数、不计入费用（宁可少算也不要按别的模型价瞎算）。
export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  return rows.reduce<UsageSummary>(
    (acc, row) => {
      const input = row.inputTokens ?? 0;
      const output = row.outputTokens ?? 0;
      return {
        inputTokens: acc.inputTokens + input,
        outputTokens: acc.outputTokens + output,
        cost:
          acc.cost +
          (row.model
            ? calcCost({ inputTokens: input, outputTokens: output, model: row.model })
            : 0),
      };
    },
    { inputTokens: 0, outputTokens: 0, cost: 0 }
  );
}

// 1.2M / 340K / 812 —— 三位以内保留一位小数，避免菜单里出现 1234567 这种读不出量级的数字
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// 费用大多是几分钱级别，直接 toFixed(2) 会显示成 $0.00 让人以为没花钱。
// 所以 0 与 0.01 之间单独给一个 "< $0.01"，既诚实又不需要展示 $0.0003 这种噪音。
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return "< $0.01";
  return `$${cost.toFixed(2)}`;
}

// 流式过程中拿不到真实 token（usage 事件要等流结束才来），只能按字符估算。
// 系数来自 BPE 分词的经验值：CJK 每 token 约 1.75 个字符，
// 拉丁字母/空格/标点每 token 约 4 个字符。显示时必须带 "~" 前缀表明是估算。
const CJK = /[　-〿぀-ヿ㐀-鿿가-힯豈-﫿＀-￯]/;

export function estimateTokens(text: string): number {
  const chars = [...text]; // 展开成码点数组，避免 emoji 等代理对被算成 2 个字符
  const cjk = chars.filter((ch) => CJK.test(ch)).length;
  const other = chars.length - cjk;
  return Math.round(cjk / 1.75 + other / 4);
}
