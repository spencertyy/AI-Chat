import { splitDraft, checkOutput, buildRetryHint } from "./personaGuard";
import type { Persona } from "../types/chat";

// 自造一个人格而不是从 PERSONAS 里取真的：真人格的 prompt 会随产品迭代改，
// 拿它当测试基准的话，改一句 prompt 就会莫名其妙挂掉一批测试。
// 测试要断言的是**校验逻辑**，不是某个人格当下的配置。
const persona: Persona = {
  id: "test",
  kind: "advisor",
  name: "Test",
  emoji: "🧪",
  tagline: "for tests",
  defaultModelId: "gemini-3.1-flash-lite",
  identity: "",
  style: "",
  strategy: "",
  bannedPhrases: {
    draft: ["no rush"],
    all: ["dating coach"],
  },
};

// 新格式：自然句（判断）+ 一行 Send: 草稿 + 自然句（行动）。
const valid = `They are pulling back without saying so.
Send: I get it, I have a full week ahead too.
Wait five days before reaching out.`;

describe("splitDraft", () => {
  it("splits a reply into before / draft / after around the Send: line", () => {
    expect(splitDraft(valid)).toEqual({
      before: "They are pulling back without saying so.",
      draft: "I get it, I have a full week ahead too.",
      after: "Wait five days before reaching out.",
    });
  });

  it("returns null when there is no Send: line", () => {
    expect(splitDraft("Just some prose with no draft line.")).toBeNull();
  });

  it("returns null when the Send: line has no content", () => {
    expect(splitDraft("A read.\nSend:\nAn action.")).toBeNull();
  });

  // 模型偶尔把标签写成 SEND: 或 send:。那只是排版差异，不该当成结构性失败
  // 去浪费一次重试——重试是真实的 API 调用，有成本也有延迟。
  it("matches the Send: label case-insensitively", () => {
    expect(splitDraft("A read.\nsend: hello there.\nAn action.")).toEqual({
      before: "A read.",
      draft: "hello there.",
      after: "An action.",
    });
  });

  // 逐行找前缀，而不是整体正则匹配——模型常在草稿前后多插空行、或多说几句。
  it("tolerates extra blank lines and trailing chatter", () => {
    const noisy = `They are pulling back.\n\n\nSend: I have a full week too.\n\nWait a few days.\n\nHope that helps!`;
    expect(splitDraft(noisy)).toEqual({
      before: "They are pulling back.",
      draft: "I have a full week too.",
      after: "Wait a few days.\n\nHope that helps!",
    });
  });

  // 万一模型手滑写了两行 Send:，取第一行、其余并入 after，至少渲染出一个
  // 确定的草稿，好过整段判失败。
  it("keeps only the first Send: line, folding the rest into after", () => {
    const twoDrafts = `A read.\nSend: first draft.\nSend: second draft.`;
    expect(splitDraft(twoDrafts)).toEqual({
      before: "A read.",
      draft: "first draft.",
      after: "Send: second draft.",
    });
  });
});

describe("checkOutput", () => {
  it("passes a clean reply with no violations", () => {
    const result = checkOutput(valid, persona);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.shouldRetry).toBe(false);
    expect(result.mustBlock).toBe(false);
  });

  // 最重要的一条：劝用户做不可逆的事，重试后仍然如此就必须丢弃。
  // 这是唯一一类"宁可给错误提示也不能放行"的违规。
  it("blocks irreversible advice from the global banned list", () => {
    const bad = valid.replace(
      "Wait five days before reaching out.",
      "Delete their number and move on.",
    );
    const result = checkOutput(bad, persona);
    expect(result.mustBlock).toBe(true);
    expect(result.shouldRetry).toBe(true);
    expect(result.violations[0].kind).toBe("global-banned");
    expect(result.violations[0].severity).toBe("block");
  });

  // 草稿改成「按需给」后（2026-08-17），纯倾诉场景没有 Send: 行是**合法**的，
  // 不再重试、不再算 structure 违规。
  it("treats a missing Send: line as valid — pure venting needs no draft", () => {
    const result = checkOutput("Just some prose, no draft line.", persona);
    expect(result.sections).toBeNull();
    expect(result.shouldRetry).toBe(false);
    expect(result.mustBlock).toBe(false);
    expect(result.violations.map((v) => v.kind)).not.toContain("structure");
  });

  it("catches a banned phrase in the Send line", () => {
    const bad = valid.replace(
      "I get it, I have a full week ahead too.",
      "No rush, take all the time you need.",
    );
    const result = checkOutput(bad, persona);
    expect(result.shouldRetry).toBe(true);
    expect(result.violations.map((v) => v.kind)).toContain("persona-banned");
  });

  // 这条是 bannedPhrases 分成 draft / all 两组的全部理由。
  // draft 组是**策略性**禁令——只有出现在要发出去的草稿里才算违规。
  // 用一个平铺数组做全文匹配的话，这里会误报。
  it("ignores a draft-only banned phrase outside the Send line", () => {
    const inBeforeText = valid.replace(
      "They are pulling back without saying so.",
      "There is no rush to answer this one.",
    );
    const result = checkOutput(inBeforeText, persona);
    expect(result.ok).toBe(true);
  });

  it("catches an all-scope banned phrase anywhere in the reply", () => {
    const bad = valid.replace(
      "They are pulling back without saying so.",
      "Any dating coach would call this a test.",
    );
    const result = checkOutput(bad, persona);
    expect(result.shouldRetry).toBe(true);
    expect(result.violations.map((v) => v.kind)).toContain("persona-banned");
  });

  // 模型会大写句首，"No rush" 和 "no rush" 是同一个违规。
  // 禁用词表统一以小写存储，比对前把输出也转小写。
  it("matches banned phrases regardless of case", () => {
    const bad = valid.replace(
      "I get it, I have a full week ahead too.",
      "NO RUSH at all on this.",
    );
    expect(checkOutput(bad, persona).shouldRetry).toBe(true);
  });

  // 词边界匹配，不是子串包含。这条是实测踩出来的：临时把 "you" 加进禁用词表
  // 验证重试逻辑时，输出里根本没有 "you"，命中的是 "yourself"。
  // 误报的代价不只是日志噪音——它会白白触发一次真实的 API 调用。
  it("does not match a banned phrase inside a longer word", () => {
    const shortWordPersona: Persona = {
      ...persona,
      bannedPhrases: { draft: [], all: ["you"] },
    };
    const noStandaloneYou = `Short read.\nSend: Nothing here.\nRemind yourself why.`;
    expect(checkOutput(noStandaloneYou, shortWordPersona).ok).toBe(true);

    const standaloneYou = `Short read.\nSend: Nothing here.\nThis is about you.`;
    expect(checkOutput(standaloneYou, shortWordPersona).shouldRetry).toBe(true);
  });

  // 词数超限只警告不重试：为几个词多花一次 API 调用和约 2 秒延迟不划算，
  // 而且超长在阅读上是瑕疵，不是错误。
  it("warns about an over-length draft without triggering a retry", () => {
    const longDraft = `Short read.\nSend: ${"word ".repeat(35)}\nShort action.`;
    const result = checkOutput(longDraft, persona);
    expect(result.ok).toBe(false);
    expect(result.shouldRetry).toBe(false);
    expect(result.mustBlock).toBe(false);
    expect(result.violations.map((v) => v.severity)).toEqual(["warn"]);
  });

  it("warns about an over-length whole reply without triggering a retry", () => {
    const longReply = `Send: short draft here.\n${"word ".repeat(85)}`;
    const result = checkOutput(longReply, persona);
    expect(result.ok).toBe(false);
    expect(result.shouldRetry).toBe(false);
    expect(result.violations.map((v) => v.severity)).toEqual(["warn"]);
  });
});

describe("buildRetryHint", () => {
  it("lists only actionable violations", () => {
    const { violations } = checkOutput(
      `Short read.\nSend: No rush ${"word ".repeat(40)}\nShort action.`,
      persona,
    );
    const hint = buildRetryHint(violations);
    expect(hint).toContain("no rush");
    // 词数问题刻意不写进提示：约束一多模型反而顾此失彼
    // （阶段 0 反复撞到的打地鼠现象）。
    expect(hint).not.toContain("word limit");
  });

  it("returns an empty string when nothing is actionable", () => {
    expect(buildRetryHint([])).toBe("");
    const warnOnly = checkOutput(
      `Short read.\nSend: ${"word ".repeat(40)}\nShort action.`,
      persona,
    ).violations;
    expect(buildRetryHint(warnOnly)).toBe("");
  });
});
