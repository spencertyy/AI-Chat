import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import type { Message, Conversation, Model } from "../types/chat";
import {
  saveConversations,
  loadConversations,
  deleteConversationFromStorage,
} from "../lib/localStorageChat";
import { PERSONAS, DEFAULT_PERSONA_ID } from "../lib/personas";

// 默认人格显式按 id 取，不用 PERSONAS[0]——这样调整列表显示顺序时
// 默认值不会跟着悄悄变（与下面 DEFAULT_MODEL 是同一个理由）。
// `!` 断言成立是因为 DEFAULT_PERSONA_ID 是本仓库内的常量，不是外部输入。
const DEFAULT_PERSONA = PERSONAS.find((p) => p.id === DEFAULT_PERSONA_ID)!;

// 只有服务端主动返回的 { error } 文案才用这个类型抛出，表示"可以直接显示给用户"。
// 其他意外异常（网络中断、JSON 解析失败、SDK 内部错误）可能带内部细节，
// 一律走通用文案，避免信息泄漏（information disclosure）。
class UserFacingError extends Error {}

// AbortError 不能用 instanceof 判断：真实的 fetch 取消抛的是 DOMException，
// 它是否继承自 Error 在各引擎/各版本并不一致；jsdom 里更是可能压根没有
// DOMException 这个全局。所以按结构判断 name 字段——这是 Web 标准明确规定的，
// 比原型链可靠。
function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

// GET /api/conversations 返回的形状。它是 Prisma 的 Conversation + messages，
// 但经过 JSON 序列化后所有 Date 字段都变成了字符串——这正是下面必须逐个
// new Date() 复水（rehydrate）的原因，也是原本那个 any 掩盖掉的事实。
type ApiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  persona: string | null;
};

type ApiConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ApiMessage[];
};

// icons8 提供的是黑色版本的图标（URL 里 color=000000）；
// 深色主题下由 .model-icon 的 filter: invert(var(--icon-invert)) 翻成白色。
const GEMINI_ICON =
  "https://img.icons8.com/?size=100&id=ukfLhUGxoO4m&format=png&color=000000";
const OPENAI_ICON =
  "https://img.icons8.com/?size=100&id=20Vlk1gdKTDO&format=png&color=000000";

// 可选模型。Gemini 侧全部有免费层（额度耗尽时 API 返回 429）；
// OpenAI 是这里唯一的付费 key，所以只保留最便宜的 gpt-4o-mini 一个。
// 排序按代次从新到旧，与用户"越新越靠前"的预期一致。
//
// ⚠️ 增删模型必须同步 lib/pricing.ts 的 PRICING 表：
// calcCost 对表里没有的 model 直接 return 0，漏掉会让用量统计静默少算。
//
// 模型 id 于 2026-07-30 用 Gemini models.list 接口核对过确实存在
// （注意 gemini-3-flash 这个 id 并不存在，正确的是 -preview 后缀）。
export const models: Model[] = [
  {
    label: "Gemini 3.6 Flash",
    id: "gemini-3.6-flash",
    provider: "gemini",
    icon: GEMINI_ICON,
  },
  {
    label: "Gemini 3.5 Flash",
    id: "gemini-3.5-flash",
    provider: "gemini",
    icon: GEMINI_ICON,
  },
  {
    label: "Gemini 3.5 Flash Lite",
    id: "gemini-3.5-flash-lite",
    provider: "gemini",
    icon: GEMINI_ICON,
  },
  {
    label: "Gemini 3.1 Flash Lite",
    id: "gemini-3.1-flash-lite",
    provider: "gemini",
    icon: GEMINI_ICON,
  },
  {
    label: "Gemini 3 Flash (Preview)",
    id: "gemini-3-flash-preview",
    provider: "gemini",
    icon: GEMINI_ICON,
  },
  {
    label: "Gemini 2.5 Flash",
    id: "gemini-2.5-flash",
    provider: "gemini",
    icon: GEMINI_ICON,
  },
  // 注：gemini-2.5-flash-lite 刻意不列。它出现在 models.list 里，但实际调用返回
  // 404「no longer available to new users」——已对新账号下线。
  {
    label: "GPT-4o mini",
    id: "gpt-4o-mini",
    provider: "openai",
    icon: OPENAI_ICON,
  },
];

// 默认模型显式按 id 取，不再用 models[0]——这样调整下拉框的显示顺序
// 不会顺带改掉默认值，两件事解耦。
//
// 选 3.1 Flash Lite 而不是 2.5 Flash：免费层每天 500 次请求，
// 而 2.5 Flash 只有 20 次。公开 demo 用 20 次撑不过一个下午。
const DEFAULT_MODEL =
  models.find((m) => m.id === "gemini-3.1-flash-lite") ?? models[0];

export default function useChat() {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null); //用于取消正在进行的请求

  const [editingId, setEditingID] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  // 复制反馈用 copiedId（记住是哪条消息）而不是布尔值——
  // 布尔值只能表达"有东西被复制了"，无法定位到具体气泡。
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const activeConversation = conversations.find((c) => c.id === activeConvId);
  const messages = activeConversation?.messages ?? [];
  const [selectModel, setSelectModel] = useState(DEFAULT_MODEL);
  // 人格与模型是**两个独立的 state**，暂时不联动。
  //
  // Persona 上虽然有 defaultModelId，但阶段 1 刻意不做"切人格自动切模型"：
  // 用户手动选过模型之后被人格覆盖掉会很困惑。那个联动是阶段 4「配额分散」
  // 的一部分，到时候连同"用户是否手动覆盖过"的状态一起处理。
  const [selectPersona, setSelectPersona] = useState(DEFAULT_PERSONA);
  const [reactions, setReactions] = useState<
    Record<
      string,
      { likes: number; dislikes: number; userVote: "likes" | "dislikes" | null }
    >
  >({});

  function handleReaction(msgId: string, type: "likes" | "dislikes") {
    setReactions((prev) => {
      const current = prev[msgId] ?? { likes: 0, dislikes: 0, userVote: null };
      if (current.userVote === type) {
        return {
          ...prev,
          [msgId]: { ...current, [type]: current[type] - 1, userVote: null },
        };
      } else {
        const opposite = type === "likes" ? "dislikes" : "likes";
        return {
          ...prev,
          [msgId]: {
            ...current,
            [type]: current[type] + 1,
            [opposite]:
              current.userVote === opposite
                ? current[opposite] - 1
                : current[opposite],
            userVote: type,
          },
        };
      }
    });
  }
  async function handleNewChat() {
    if (isAuthenticated) {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Conversation" }),
      });
      const newConv = await response.json();
      setConversations((prev) => [newConv, ...prev]);
      setActiveConvId(newConv.id);
    } else {
      const newConv: Conversation = {
        id: crypto.randomUUID(),
        title: "New Conversation",
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setConversations((prev) => {
        const updated = [newConv, ...prev];
        saveConversations(updated);
        return updated;
      });
      setActiveConvId(newConv.id);
    }
  }
  async function handleDeleteConv(convId: string) {
    if (isAuthenticated) {
      await fetch(`/api/conversations/${convId}`, { method: "DELETE" });
    } else {
      deleteConversationFromStorage(convId);
    }
    setConversations((prev) => prev.filter((conv) => conv.id !== convId));
    if (activeConvId === convId) setActiveConvId(null);
  }
  async function handleRenameConv(convId: string, newTitle: string) {
    if (isAuthenticated) {
      await fetch(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === convId ? { ...conv, title: newTitle } : conv,
        ),
      );
    } else {
      setConversations((prev) => {
        const updated = prev.map((conv) =>
          conv.id === convId ? { ...conv, title: newTitle } : conv,
        );
        saveConversations(updated);
        return updated;
      });
    }
  }
  function setMessages(
    updater: Message[] | ((prev: Message[]) => Message[]),
    targetId: string | null = activeConvId,
  ) {
    setConversations((prevConvs) => {
      const updated = prevConvs.map((conv) => {
        if (conv.id !== targetId) return conv;
        const newMessages =
          typeof updater === "function" ? updater(conv.messages) : updater;
        return { ...conv, messages: newMessages, updatedAt: new Date() };
      });
      // updatedAt 기준 내림차순 정렬 — 최신 대화가 항상 맨 위
      return updated.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    });
  }

  function startEditing(msg: Message) {
    if (isLoading) return;
    setEditingID(msg.id);
    setEditingText(msg.content);
  }
  function cancelEditMessage() {
    setEditingID(null);
    setEditingText("");
  }
  function saveEditMessage(messageId: string) {
    const newText = editingText.trim();
    if (!newText) return;
    const messageIndex = messages.findIndex((msg) => msg.id === messageId);
    if (messageIndex === -1) return;
    const editedMessage: Message = {
      ...messages[messageIndex],
      content: newText,
      timestamp: new Date(),
    };
    const messageBeforeEdited = messages.slice(0, messageIndex);
    const updatedMessages = [...messageBeforeEdited, editedMessage];
    setEditingID(null);
    setEditingText("");
    setMessages(updatedMessages);
    handleSend(newText, [...messageBeforeEdited, editedMessage], false);
  }
  function handleClear() {
    if (!activeConvId) return;
    setMessages([]);
    setCleared(true);
    setTimeout(() => setCleared(false), 1500);
  }
  function handleStop() {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  }
  function handleRegenerate() {
    if (isLoading) return;
    const lastAssostantIndex = messages
      .map((msg) => msg.role)
      .lastIndexOf("assistant");

    if (lastAssostantIndex === -1) return;

    const messagesWhithoutLastAssistant = messages.slice(0, lastAssostantIndex);
    const lastUserMessage = [...messagesWhithoutLastAssistant]
      .reverse()
      .find((msg) => msg.role === "user");

    if (!lastUserMessage) return;
    setMessages(messagesWhithoutLastAssistant);
    handleSend(lastUserMessage.content, messagesWhithoutLastAssistant, false);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (status === "loading") return; // 等待 session 加载完毕再判断

    async function load() {
      if (isAuthenticated) {
        const response = await fetch("/api/conversations");
        if (!response.ok) return;
        const data: ApiConversation[] = await response.json();
        // 三处 new Date 一个都不能少：JSON 里只有字符串，而 Conversation /
        // Message 类型声明的是 Date。原来只复水了 messages[].timestamp，
        // 会话自身的 createdAt / updatedAt 一直是字符串冒充 Date——
        // 之所以没炸，只是因为排序处写了 new Date(b.updatedAt) 兜底。
        const conversations: Conversation[] = data.map((conv) => ({
          ...conv,
          createdAt: new Date(conv.createdAt),
          updatedAt: new Date(conv.updatedAt),
          messages: conv.messages.map((msg) => ({
            ...msg,
            timestamp: new Date(msg.createdAt),
            inputTokens: msg.inputTokens ?? undefined,
            outputTokens: msg.outputTokens ?? undefined,
            model: msg.model ?? undefined,
            // 数据库里是 null（历史消息没有这一列），前端类型用的是可选属性。
            // 转成 undefined 才能让 `msg.persona ? ... : ...` 这类判断按预期
            // 走——JSON 里的 null 是个真实的值，不会触发默认值逻辑。
            persona: msg.persona ?? undefined,
          })),
        }));
        setConversations(conversations);
      } else {
        // 未登录：从 localStorage 读取
        setConversations(loadConversations());
      }
    }
    load();
  }, [status]);

  async function handleSend(
    text?: string,
    baseMessages = messages,
    shouldAddUserMessage = true,
  ) {
    if (isLoading) return;
    const messageText = (text ?? input).trim();
    if (!messageText) return;

    let convId = activeConvId;
    if (!convId) {
      if (isAuthenticated) {
        const response = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New Conversation" }),
        });
        const newConv = await response.json();
        setConversations((prev) => [newConv, ...prev]);
        setActiveConvId(newConv.id);
        convId = newConv.id;
      } else {
        const newConv: Conversation = {
          id: crypto.randomUUID(),
          title: "New Conversation",
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        setConversations((prev) => {
          const updated = [newConv, ...prev];
          saveConversations(updated);
          return updated;
        });
        setActiveConvId(newConv.id);
        convId = newConv.id;
      }
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: messageText,
      timestamp: new Date(),
    };
    const streamingId = crypto.randomUUID();

    const streamingMessage: Message = {
      id: streamingId,
      role: "assistant",
      content: "",
      streaming: true,
      timestamp: new Date(),
      // persona 在**创建占位消息时**就写死，而不是等流结束再补。
      //
      // 两个原因：① 这条消息有两个出口——正常收到 [DONE]、和用户中途按停止，
      // 两边都从 streamingMessage 展开。写在源头，两条路径自动都有，不会出现
      // "改了一边忘了另一边"（本仓库的持久化 bug 就是这么来的）。
      // ② 用户可能在流式过程中切换人格，那时 selectPersona 已经变了——
      // 这条回复该记的是**发起时**的人格，不是读完时的。
      //
      // ⚠️ 既有的不一致：model 字段只在 [DONE] 分支设置，中途停止的消息没有
      // model。已记进 improvement-plan 待办，本次不动它以免影响现有测试断言。
      persona: selectPersona.id,
    };
    //Throttle
    //在流式过程中，AI 可能会频繁地更新消息内容（每个字符或每几个字符）。如果我们每次更新都调用 setMessages 并保存聊天记录，会导致性能问题。为了解决这个问题，我们可以实现一个节流机制，限制更新消息的频率，例如每 40ms 更新一次。
    let assistantContent = "";
    let lastFlushTime = 0;

    let inputTokens = 0;
    let outputTokens = 0;
    // 服务端在流的最前面发降级帧，所以第一次 flush 之前它就已经就位——
    // 提示条和正文同时出现，不会等到流结束才补上一个迟到的标记。
    let degraded: Message["degraded"];

    function flushAssistantMessage(force = false) {
      const now = Date.now();
      if (!force && now - lastFlushTime < 40) return; //节流，避免过于频繁地更新消息
      lastFlushTime = now;
      setMessages(
        (prev) =>
          prev.map((msg) =>
            msg.id === streamingId
              ? { ...msg, content: assistantContent, degraded }
              : msg,
          ),
        convId,
      );
    }

    // 一轮问答有两个正常出口：[DONE] 和用户中途停止。两个都必须落盘，
    // 所以保存逻辑抽出来共用——写成两份复制粘贴的代码，迟早只改一边。
    async function persistMessages(finalMessages: Message[]) {
      if (isAuthenticated) {
        await fetch(`/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: finalMessages }),
        });
      } else {
        // 未登录：把整个对话列表同步到 localStorage
        setConversations((prev) => {
          saveConversations(prev);
          return prev;
        });
      }
    }

    const updatedMessages = shouldAddUserMessage
      ? [...baseMessages, userMessage]
      : [...baseMessages];
    const title =
      messageText.slice(0, 24) + (messageText.length > 24 ? "..." : "");

    setMessages([...updatedMessages, streamingMessage], convId);
    // 第一条消息时自动更新标题。
    //
    // 判断依据必须来自本次调用内已知的事实，不能用 activeConversation ——
    // 它取自调用那一刻的闭包，而会话可能是在这次调用里刚创建的，
    // 闭包里还是 undefined（`undefined === 0` 为 false，分支永远进不去）。
    // 同理，下面 map 的匹配也要用 convId 而不是闭包里的 activeConvId。
    if (shouldAddUserMessage && baseMessages.length === 0) {
      setConversations((prev) =>
        prev.map((conv) => (conv.id === convId ? { ...conv, title } : conv)),
      );
      if (isAuthenticated) {
        await fetch(`/api/conversations/${convId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
      }
    }

    setInput("");
    setIsLoading(true);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await fetch("/api/chat-stream", {
        method: "POST",
        signal: controller.signal, //允许我们在需要时取消请求。
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          model: selectModel.id,
          provider: selectModel.provider,
          // 只传 id，不传 prompt 文本——服务端按白名单查表（见 lib/personas.ts
          // 的 getPersona）。把 prompt 交给客户端等于开放任意 system instruction
          // 注入，任何能发 HTTP 请求的人都能改写 AI 的身份。
          personaId: selectPersona.id,
        }),
      });
      if (!response.ok) {
        // 非 2xx 时 body 是一个 JSON 错误对象（不是 SSE 流），先读出来再抛。
        // .catch(() => null) 兜底：万一响应不是 JSON（例如网关返回 HTML 502），
        // .json() 会抛错，那就退回通用文案。
        const data = await response.json().catch(() => null);
        throw data?.error
          ? new UserFacingError(data.error)
          : new Error("Streaming request failed");
      }
      if (!response.body) {
        throw new Error("Streaming request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        //console.log("raw buffer:", buffer);

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        // console.log("events:", events);

        for (const event of events) {
          if (!event.startsWith("data: ")) continue;

          const data = event.replace("data: ", "").trim();

          if (data === "[DONE]") {
            flushAssistantMessage(true); //强制刷新剩余内容
            const finalMessages: Message[] = [
              ...updatedMessages,
              {
                ...streamingMessage,
                content: assistantContent,
                streaming: false,
                inputTokens,
                outputTokens,
                model: selectModel.id,
                degraded,
              },
            ];
            setMessages(finalMessages, convId);
            await persistMessages(finalMessages);
            return;
          }
          const parsed = JSON.parse(data);

          if (parsed.error) {
            // 流内部的错误（例如 429 额度耗尽）也是服务端写死的文案，可以显示
            throw new UserFacingError(parsed.error);
          }
          if (parsed.type === "usage") {
            inputTokens = parsed.inputTokens;
            outputTokens = parsed.outputTokens;
          }
          // 公开 demo 额度用尽，后面的正文是预录内容而非模型输出。
          // 这一帧总是排在所有文本之前，标记因此能和第一个字符同时到位。
          if (parsed.type === "degraded") {
            degraded = parsed.reason;
          }

          const delta = parsed.text ?? "";
          for (let i = 0; i < delta.length; i++) {
            assistantContent += delta[i];
            flushAssistantMessage();
          }
        }
      }
    } catch (error: unknown) {
      if (isAbortError(error)) {
        const stopedMessages: Message[] = [
          ...updatedMessages,
          {
            ...streamingMessage,
            content:
              assistantContent + "\n\n*--- Response stopped by user ---*",
            streaming: false,
          },
        ];
        setMessages(stopedMessages, convId);
        // 停止不是"失败"，已生成的内容是用户想留下的成果，
        // 必须和 [DONE] 一样落盘——否则刷新页面只剩一个空壳会话。
        await persistMessages(stopedMessages);
        return;
      }
      // 只有 UserFacingError 的 message 才可信；其余一律通用文案
      const content =
        error instanceof UserFacingError
          ? error.message
          : "Sorry, something went wrong. Please try again.";
      setMessages(
        (prev) =>
          prev.map((msg) =>
            msg.id === streamingId
              ? {
                  ...msg,
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content,
                  streaming: false,
                }
              : msg,
          ),
        convId,
      );
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }
  return {
    input,
    setInput,
    messages,
    conversations,
    activeConvId,
    setActiveConvId,
    isLoading,
    cleared,
    editingId,
    editingText,
    setEditingText,
    copiedId,
    setCopiedId,
    reactions,
    bottomRef,
    handleSend,
    handleReaction,
    handleNewChat,
    handleDeleteConv,
    handleClear,
    handleStop,
    handleRegenerate,
    startEditing,
    cancelEditMessage,
    saveEditMessage,
    models,
    selectModel,
    setSelectModel,
    personas: PERSONAS,
    selectPersona,
    setSelectPersona,
    handleRenameConv,
  };
}
