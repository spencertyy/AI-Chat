interface Message {
  id: string;
  role: "user" | "assistant";
  streaming?: boolean;
  content: string;
  timestamp: Date;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  /**
   * 生成这条回复的人格 id。只有 assistant 消息有值，用户消息没有。
   *
   * 存 id 不存人格名：名字会改（"Straight Up" 就是从 "Assistant" 改来的），
   * id 才是稳定标识。历史消息不该因为改了个显示名就对不上。
   *
   * 可选是因为这个字段是后加的——此前入库的消息没有这个值，读出来是
   * undefined，界面上不显示人格标识即可。
   */
  persona?: string;
  /**
   * 这条回复来自公开 demo 的预录内容，不是模型生成的；值表示被哪一层
   * 限流拦下（ip = 单人超速，global = 全站当日额度用尽）。
   *
   * 只在当次会话内有效：消息落库的 API 显式列字段，不含此项，所以刷新
   * 后登录用户看不到标记了。未登录用户走 localStorage 全量序列化，会保留。
   * 这个不一致是有意接受的——降级是即时状态，不是需要留档的历史。
   */
  degraded?: "ip" | "global";
}
interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}
interface Model {
  label: string;
  id: string;
  provider: string;
  icon: string;
}

/**
 * 一个「人格」= 预设的身份 + 说话风格 + 行动策略。
 *
 * prompt 的内容和它是怎么迭代出来的，见 docs/improvement-plan.md 的阶段 0：
 * 风格和策略是**两个独立维度**，必须分开约束——只写风格会导致三个人格的建议
 * 雷同，只写策略会导致人格没有个性。
 */
interface Persona {
  /** 稳定标识。随请求体发到服务端，也会存进 Message 表，改名不要改它 */
  id: string;
  /**
   * 这个人格属于哪一类，决定 prompt 怎么拼、输出长什么样：
   *
   * - `advisor`：回复军师。追加共同底线段 + 自然对话格式（正文若干自然句，
   *   其中一行 `Send:` 是可发送草稿，前端会把它渲染成一键复制卡片）。
   * - `assistant`：通用问答。不加军师格式，走 markdown / 表格那套自由输出。
   *
   * 抽成字段而不是靠 id 硬判断（`id === "plain"`），是因为**阶段 3 的三栏对比
   * 只能在 advisor 之间进行**——通用问答放进对比栏毫无意义。有了这个字段，
   * 筛选就是 `PERSONAS.filter(p => p.kind === "advisor")`，加新人格时自动生效。
   */
  kind: "advisor" | "assistant";
  /** 界面显示名，如「毒舌闺蜜」 */
  name: string;
  /** 头像 emoji。是 avatar 图片缺失/加载失败时的兜底，所以永远要填 */
  emoji: string;
  /**
   * 头像图片路径（可选）。填了就用图片、不填就用 emoji。
   * 放 public/avatars/ 下、用 "/avatars/xxx.png" 引用（随代码部署，最稳）。
   * 图片加载失败时 Avatar 组件会自动回退到 emoji，不会显示裂图。
   * ⚠️ 只用免费可商用素材（DiceBear / Open Peeps 等）或自己生成，别用网图，
   * 这个项目要公开展示，不能埋版权隐患。
   */
  avatar?: string;
  /** 一句话定位，显示在名字下方，如「先戳破，再给你台阶」 */
  tagline: string;
  /**
   * 默认绑定的模型 id（对应 ModelSelector 里 models[] 的 id）。
   * 阶段 4 用它做配额分散：不同人格走不同模型 = 不同的免费额度桶。
   */
  defaultModelId: string;

  // --- prompt 分三块存，不存拼好的整段 ---
  //
  // 因为还有第四块「输出格式段」是三个人格**完全共用**的（三段结构 + 分项
  // 字数）。存整段的话那一块会重复三遍，以后想把草稿上限从 40 字改成 50 字
  // 得改三处，漏一处就出现"两个人格守 40、一个守 50"的静默不一致。
  // 所以格式段作为 personas.ts 里的共享常量，由 buildSystemPrompt() 统一追加。

  /** 「你是谁」，一句话身份设定 */
  identity: string;
  /** 【风格：X】怎么说话——可操作技法 + 严禁清单 */
  style: string;
  /** 【策略：Y】主张什么行动 + 草稿层面的硬性要求 */
  strategy: string;

  /** 输出校验用的禁用词，交给 personaGuard 逐段检查 */
  bannedPhrases: BannedPhrases;
}

/**
 * 禁用词按「该查哪一段」分组。
 *
 * 不做成一个平铺数组全文匹配，是因为两类禁用词的作用域本来就不同：
 * 老江湖禁「没关系」是**策略性**的——只有出现在要发出去的草稿里才算违规，
 * 出现在给用户看的判断段里完全无所谓，平表匹配会误伤。
 *
 * 依据来自阶段 0 实测：禁用清单对草稿段有效、对判断段效果差
 * （见 docs/improvement-plan.md）。
 */
interface BannedPhrases {
  /** 只在「回复草稿」那一段里禁 —— 策略性禁用 */
  draft: string[];
  /** 三段全查 —— 底线性禁用（脏话、人身攻击、动物比喻等） */
  all: string[];
}

export type { Message, Conversation, Model, Persona, BannedPhrases };
