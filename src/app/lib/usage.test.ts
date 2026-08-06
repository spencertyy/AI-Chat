import {
  summarizeUsage,
  formatTokens,
  formatCost,
  estimateTokens,
} from "./usage";

describe("summarizeUsage", () => {
  it("空列表返回全 0，不是 NaN", () => {
    expect(summarizeUsage([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    });
  });

  it("token 直接加总，费用按各自模型单价分别计算", () => {
    const summary = summarizeUsage([
      // gemini-2.5-flash: 0.30 in / 2.50 out → 0.30 + 2.50 = 2.80
      { model: "gemini-2.5-flash", inputTokens: 1_000_000, outputTokens: 1_000_000 },
      // gpt-4o-mini: 0.15 in / 0.60 out → 0.15 + 0.60 = 0.75
      { model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    ]);
    expect(summary.inputTokens).toBe(2_000_000);
    expect(summary.outputTokens).toBe(2_000_000);
    expect(summary.cost).toBeCloseTo(3.55);
  });

  // model 字段是后加的，早于它写入的消息 model 为 null。
  // 这些 token 仍然真实存在（该计入总量），但没法归到某个单价上（不该计入费用）。
  it("model 为 null 的旧数据计入 token、不计入费用", () => {
    const summary = summarizeUsage([
      { model: null, inputTokens: 500, outputTokens: 900 },
    ]);
    expect(summary.inputTokens).toBe(500);
    expect(summary.outputTokens).toBe(900);
    expect(summary.cost).toBe(0);
  });

  // Prisma 的 _sum 在没有匹配行时每个字段都返回 null
  it("字段为 null / undefined 时按 0 处理", () => {
    expect(
      summarizeUsage([{ model: "gpt-4o-mini" }, { inputTokens: null }]),
    ).toEqual({ inputTokens: 0, outputTokens: 0, cost: 0 });
  });
});

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [812, "812"],
    [1_500, "1.5K"],
    [340_000, "340.0K"],
    [1_200_000, "1.2M"],
  ])("%s → %s", (input, expected) => {
    expect(formatTokens(input as number)).toBe(expected);
  });
});

describe("formatCost", () => {
  it("零消费显示 $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  // toFixed(2) 会把 0.0003 显示成 $0.00，和"完全没花钱"看起来一模一样
  it("不足一分钱显示 < $0.01 而不是 $0.00", () => {
    expect(formatCost(0.0003)).toBe("< $0.01");
  });

  it("正常金额保留两位小数", () => {
    expect(formatCost(0.4237)).toBe("$0.42");
  });
});

describe("estimateTokens", () => {
  it("空字符串是 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  // 英文按 4 字符/token：8 个字符 → 2
  it("拉丁文本约 4 字符一个 token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  // 中文按 1.75 字符/token：7 个字 → 4
  it("CJK 文本约 1.75 字符一个 token", () => {
    expect(estimateTokens("今天天气很好啊")).toBe(4);
  });

  // 用码点数组展开而不是 .length，否则 emoji 这类代理对（surrogate pair）会被算成 2 个字符
  it("emoji 按一个码点计算", () => {
    expect(estimateTokens("🤖🤖🤖🤖")).toBe(1);
  });
});
