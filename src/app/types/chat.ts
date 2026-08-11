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
export type { Message, Conversation, Model };
