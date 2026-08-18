import type { Persona } from "../types/chat";
import { SECTION_LIMITS, GLOBAL_BANNED_PHRASES, DRAFT_PREFIX } from "./personas";

// 军师人格输出的校验层。
//
// 存在的理由（阶段 0 的最终结论，详见 docs/improvement-plan.md）：
// **LLM 输出是概率采样的，prompt 只能提高服从概率，不能保证服从。**
// 这不是理论——同一段 prompt 同一个模型，实测出现过：
//   · Gentle 把 Read:/Send:/Do: 三个标签整个丢了（prompt 里写着 MUST）
//   · Veteran 输出 "see if you will chase"（prompt 里明令禁止话术腔）
//   · Savage 输出 "delete their contact information"（底线段写着永不建议删除）
//
// 所以正确的心态是把模型当成**不可信的外部服务**：校验、重试、降级。
// 这个模块是纯函数，不发请求、不碰 IO——重试由调用方（route.ts）负责。

/**
 * 从一段军师输出里拆出的三块。草稿（draft）是那行 `Send:` 去掉前缀后的内容；
 * before / after 是草稿前后的自然文本。前端渲染时 before/after 走 markdown，
 * draft 单独渲染成一键复制卡片。
 */
export type Sections = {
  /** 草稿行之前的自然文本（你对处境的判断） */
  before: string;
  /** 那句可发送的草稿（`Send:` 去掉前缀、去掉首尾空白） */
  draft: string;
  /** 草稿行之后的自然文本（用户自己接下来做什么） */
  after: string;
};

/**
 * 违规的严重程度决定调用方怎么处置，**不是所有违规都同等对待**：
 *
 * - `block` 安全问题（劝人删号拉黑）。重试后仍然违规就必须丢弃，不能放行。
 * - `retry` 功能/质量问题（解析不出三段、命中人格禁用词）。重试一次，
 *   仍失败则放行——一个措辞不完美的回答，好过一个错误提示。
 * - `warn`  瑕疵（词数超一点）。只记录，从不因此重试：为几个词多花一次
 *   API 调用和 2 秒延迟不划算。
 */
export type Severity = "block" | "retry" | "warn";

export type Violation = {
  kind: "structure" | "global-banned" | "persona-banned" | "length";
  severity: Severity;
  /** 给开发者看的日志文案，同时会拼进重试提示里给模型看 */
  detail: string;
};

export type GuardResult = {
  /** 完全没有违规 */
  ok: boolean;
  /** 拆出的草稿+前后文；没有 Send: 行（结构违规）时为 null */
  sections: Sections | null;
  violations: Violation[];
  /** 存在 block 或 retry 级违规——值得再生成一次 */
  shouldRetry: boolean;
  /** 存在 block 级违规——重试后仍然如此就不能发给用户 */
  mustBlock: boolean;
};

/**
 * 从整段输出里拆出草稿行及其前后文。**前后端共用这一个函数**——校验层靠它
 * 定位草稿段查禁用词，前端靠它把草稿渲染成一键复制卡片。单一真相源，两边
 * 对"哪句是草稿"的判断永远一致。
 *
 * 用「逐行找 Send: 开头」而不是整体正则匹配，是因为模型常在正文里多插空行、
 * 或在草稿前后写好几句。逐行找前缀对这些噪声免疫。
 *
 * 前缀比对忽略大小写：模型偶尔写成 "SEND:" 或 "send:"，那只是排版差异，
 * 不该当成结构性失败去浪费一次重试。
 *
 * 只认**第一**行 Send:：万一模型手滑写了两行，取第一行、其余并入 after，
 * 至少能渲染出一个确定的草稿，好过整段判失败。
 */
export function splitDraft(text: string): Sections | null {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) =>
    l.trim().toLowerCase().startsWith(DRAFT_PREFIX.toLowerCase()),
  );
  if (idx === -1) return null;

  const draft = lines[idx].trim().slice(DRAFT_PREFIX.length).trim();
  // 草稿行只有 "Send:" 没有内容 → 结构不完整，当失败处理
  if (!draft) return null;

  const before = lines.slice(0, idx).join("\n").trim();
  const after = lines.slice(idx + 1).join("\n").trim();
  return { before, draft, after };
}

/** 英文按空白分词。中文场景下这个数字没意义，但本 app 输出全英文 */
function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * 短语匹配 —— 用**词边界**而不是子串包含。
 *
 * 这条是实测踩出来的：验证重试逻辑时临时把 "you" 加进禁用词表，结果重试后
 * 的输出被判仍然违规，但正文里根本没有 "you" —— 命中的是 **"yourself"**，
 * 因为 `"yourself".includes("you")` 为真。
 *
 * 子串匹配会让任何短禁用词误伤一片（you→yourself/young、on→one）。误报的
 * 代价不只是日志噪音：它会白白触发一次重试，也就是一次真实的 API 调用
 * 加两秒延迟。
 *
 * `\b` 是「单词字符与非单词字符之间的位置」。禁用词里含空格和撇号
 * （"i'll be here"）也没问题——两端加边界即可，中间的空白照常参与匹配。
 * 正则元字符要先转义，否则短语里的 `.` 之类会被当成通配符。
 */
function includesPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * 校验一次模型输出。
 *
 * @param text    模型返回的完整文本（**必须是完整的**，流式途中调用没有意义）
 * @param persona 当前人格，用它自己的 bannedPhrases
 */
export function checkOutput(text: string, persona: Persona): GuardResult {
  const violations: Violation[] = [];
  const sections = splitDraft(text);

  // 所有短语比对一律转小写：模型会大写句首，"No rush" 和 "no rush" 是同一个
  // 违规。personas.ts 里的禁用词表因此全部以小写形式存储。
  const lower = text.toLowerCase();

  // ① 全局禁令 —— 劝人删号/拉黑这类不可逆操作。任何人格、任何段落都不许出现。
  //    放在最前面检查：它是唯一一类"宁可不回答也不能放行"的违规。
  for (const phrase of GLOBAL_BANNED_PHRASES) {
    if (includesPhrase(lower, phrase)) {
      violations.push({
        kind: "global-banned",
        severity: "block",
        detail: `advised an irreversible action: "${phrase}"`,
      });
    }
  }

  // ② 结构 —— 没有 Send: 草稿行**不再是错误**（2026-08-17 草稿改成「按需给」）：
  //    纯倾诉场景本就不该塞草稿，缺草稿是合法输出。只有当草稿存在时，才继续
  //    校验它的禁用词与词数（见 ③④，都包在 `if (sections)` 里）。

  // ③ 人格自己的禁用词
  //    draft 组只查草稿段——这是有意的。老江湖禁「no worries」是**策略性**的：
  //    只有出现在要发出去的消息里才算违规，出现在给用户看的判断句里无所谓。
  //    平表全文匹配会误伤，所以 Persona.bannedPhrases 才分了两组。
  if (sections) {
    const draftLower = sections.draft.toLowerCase();
    for (const phrase of persona.bannedPhrases.draft) {
      if (includesPhrase(draftLower, phrase)) {
        violations.push({
          kind: "persona-banned",
          severity: "retry",
          detail: `the Send line used a banned phrase: "${phrase}"`,
        });
      }
    }
  }
  for (const phrase of persona.bannedPhrases.all) {
    if (includesPhrase(lower, phrase)) {
      violations.push({
        kind: "persona-banned",
        severity: "retry",
        detail: `used a banned phrase: "${phrase}"`,
      });
    }
  }

  // ④ 词数 —— 只警告不重试。为几个词多花一次 API 调用和 2 秒延迟不划算，
  //    而且超长在阅读上是瑕疵，不是错误。
  //    两项：草稿（硬约束好守）+ 整段正文（软上限，防"自然对话"跑成长文）。
  if (sections) {
    const draftWords = wordCount(sections.draft);
    if (draftWords > SECTION_LIMITS.draft) {
      violations.push({
        kind: "length",
        severity: "warn",
        detail: `the Send line ran ${draftWords} words, over the ${SECTION_LIMITS.draft}-word limit`,
      });
    }
    const replyWords = wordCount(text);
    if (replyWords > SECTION_LIMITS.reply) {
      violations.push({
        kind: "length",
        severity: "warn",
        detail: `the whole reply ran ${replyWords} words, over the ${SECTION_LIMITS.reply}-word limit`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    sections,
    violations,
    shouldRetry: violations.some((v) => v.severity !== "warn"),
    mustBlock: violations.some((v) => v.severity === "block"),
  };
}

/**
 * 把违规原因拼成给模型看的重试提示。
 *
 * 关键是**告诉它上一次错在哪**，而不是原样再问一遍——重新采样只是碰运气，
 * 把违规点写进上下文才是让它避开同一个坑。
 *
 * 只带 block / retry 级的问题：warn 级（词数）不值得为它施压，
 * 而且约束一多模型反而顾此失彼（阶段 0 的打地鼠现象）。
 */
export function buildRetryHint(violations: Violation[]): string {
  const actionable = violations.filter((v) => v.severity !== "warn");
  if (actionable.length === 0) return "";

  return [
    "Your previous answer was rejected for these reasons:",
    ...actionable.map((v) => `- ${v.detail}`),
    "Write it again, fixing every point above. Keep the format: plain natural sentences, with the message to send on a single line starting with 'Send:'.",
  ].join("\n");
}
