import { calcCost } from "./pricing";
import { models } from "../hooks/useChat";

describe("calcCost", () => {
  it("calculates cost for a known model (gemini)", () => {
    expect(
      calcCost({
        inputTokens: 1000000,
        outputTokens: 1000000,
        model: "gemini-2.5-flash",
      }),
    ).toBeCloseTo(2.8);
  });
});

describe("calcCost", () => {
  it("calculates cost for gpt-4o-mini", () => {
    expect(
      calcCost({
        inputTokens: 1000000,
        outputTokens: 1000000,
        model: "gpt-4o-mini",
      }),
    ).toBeCloseTo(0.75);
  });
});

describe("returns 0 for an unknown model", () => {
  it("should return the correct cost", () => {
    expect(
      calcCost({
        inputTokens: 1000000,
        outputTokens: 1000000,
        model: "unknown-model",
      }),
    ).toBe(0);
  });
});

// 这个 0 兜底是把双刃剑：它防止未知模型让页面崩掉，但也意味着
// 「模型加进了选择器却忘了加价格」不会报错，只会静默把消费算成 0。
// 注释拦不住这种事，所以用测试拦：选择器里每一个模型都必须能算出正的成本。
describe("每个可选模型都必须在 PRICING 表里有条目", () => {
  it.each(models.map((m) => [m.label, m.id]))(
    "%s (%s) 有定价",
    (_label, id) => {
      const cost = calcCost({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        model: id,
      });
      expect(cost).toBeGreaterThan(0);
    },
  );
});
