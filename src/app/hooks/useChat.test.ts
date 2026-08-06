import { renderHook, act } from "@testing-library/react";
import useChat from "./useChat";

// ─────────────────────────────────────────────────────────────
// Session mock
//
// jest.mock 的工厂函数会被提升（hoist）到所有 import 之前执行，所以它不能引用
// 外部变量——除非变量名以 "mock" 开头，这是 babel-plugin-jest-hoist 特批的白名单。
// 用一个可变量而不是写死，是为了同一个文件里既能测游客路径也能测登录路径。
// ─────────────────────────────────────────────────────────────
let mockSessionStatus: "authenticated" | "unauthenticated" = "unauthenticated";

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    status: mockSessionStatus,
    data: mockSessionStatus === "authenticated" ? { user: {} } : null,
  }),
}));

// ─────────────────────────────────────────────────────────────
// SSE 测试替身
//
// 这里刻意**不** mock 掉 SSE 解析本身——那正是要测的东西。
// 我们只伪造一个形状正确的 Response：body.getReader() 吐出真的 Uint8Array，
// 让 useChat 里的 TextDecoder + buffer 拼接逻辑真的跑一遍。
// ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL_ID = "gemini-3.1-flash-lite";
const GENERIC_ERROR = "Sorry, something went wrong. Please try again.";
const STOP_MARKER = "*--- Response stopped by user ---*";

/** 把一个对象包成一条 SSE 事件（`data: {...}\n\n`） */
function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
const DONE = "data: [DONE]\n\n";

/**
 * 伪造流式 Response。chunks 数组的每一项 = 网络上的一个分片。
 * 分片边界故意可以落在 SSE 事件中间，用来验证 buffer 拼接。
 */
function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { value: encoder.encode(chunks[i++]), done: false }
            : { value: undefined, done: true },
      }),
    },
  };
}

/** 一次正常的问答：先吐文本，再报 usage，最后 [DONE] */
function normalStream(text = "Hello", inputTokens = 12, outputTokens = 34) {
  return streamResponse([
    sse({ text }),
    sse({ type: "usage", inputTokens, outputTokens }),
    DONE,
  ]);
}

/** 非 2xx 响应：body 是 JSON 错误对象而不是 SSE 流 */
function errorResponse(error: string) {
  return { ok: false, json: async () => ({ error }) };
}

/**
 * 先吐一个分片，之后一直挂着，直到 signal 被 abort 才 reject——
 * 真实的 reader.read() 就是这个行为。
 *
 * 注意 `signal.aborted` 那个分支：往一个**已经 abort** 的 signal 上加监听器
 * 永远不会触发，少了这行守卫，一旦停止发生得比第一次 read 还早，
 * 这个 promise 就永远悬着，测试直接超时。
 */
function abortableAfterChunk(text: string) {
  const encoder = new TextEncoder();
  let delivered = false;
  return jest.fn(async (_url: string, init: { signal: AbortSignal }) => ({
    ok: true,
    body: {
      getReader: () => ({
        read: () => {
          if (!delivered) {
            delivered = true;
            return Promise.resolve({
              value: encoder.encode(sse({ text })),
              done: false,
            });
          }
          return new Promise((_resolve, reject) => {
            const fail = () => {
              const err = new Error("The operation was aborted.");
              err.name = "AbortError";
              reject(err);
            };
            if (init.signal.aborted) fail();
            else init.signal.addEventListener("abort", fail);
          });
        },
      }),
    },
  }));
}

/**
 * 让 mock fetch 真的响应 abort 信号——真实 fetch 就是这么做的：
 * signal 触发时用一个 name 为 "AbortError" 的错误 reject。
 * 不接这个信号的话，handleStop 只会改 isLoading，测不到 catch 分支。
 */
function abortableFetch() {
  return jest.fn(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      }),
  );
}

let mockFetch: jest.Mock;

beforeEach(() => {
  localStorage.clear();
  mockSessionStatus = "unauthenticated";
  mockFetch = jest.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
});

/** 读回 localStorage 里持久化的对话，省得每处都写一遍 JSON.parse */
function storedConversations() {
  return JSON.parse(localStorage.getItem("conversations") ?? "[]");
}

// ═════════════════════════════════════════════════════════════
describe("useChat — optimistic updates and SSE parsing", () => {
  it("inserts the user message and a streaming placeholder before the response arrives", async () => {
    // 一个"永远不 resolve 的 fetch"，把时间冻结在"请求已发出、响应未到"的瞬间
    let releaseFetch!: (value: unknown) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseFetch = resolve;
      }),
    );

    const { result } = renderHook(() => useChat());

    // 故意不 await：要观察的正是 await 之前的那一帧状态
    act(() => {
      result.current.handleSend("Hi there");
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "Hi there",
    });
    // 占位消息：内容为空但已经占好位置，UI 才能立刻显示"正在输入"
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      content: "",
      streaming: true,
    });
    expect(result.current.isLoading).toBe(true);
    // 输入框应当已经清空——用户可以马上打下一句
    expect(result.current.input).toBe("");

    await act(async () => {
      releaseFetch(normalStream());
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages[1].streaming).toBe(false);
  });

  it("reassembles an SSE event split across chunk boundaries", async () => {
    // 关键用例：网络分片不会对齐事件边界。
    // 这里把 `data: {"text":"World"}\n\n` 从 JSON 中间劈成两片——
    // 如果 buffer 拼接逻辑写错，JSON.parse 会在半个 JSON 上抛错。
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        'data: {"text":"Hel',
        'lo, "}\n\ndata: {"text":"Wor',
        'ld"}\n\n',
        DONE,
      ]),
    );

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    expect(result.current.messages[1].content).toBe("Hello, World");
  });

  it("handles several SSE events packed into a single chunk", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        sse({ text: "A" }) + sse({ text: "B" }) + sse({ text: "C" }),
        DONE,
      ]),
    );

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    expect(result.current.messages[1].content).toBe("ABC");
  });

  it("writes the real token counts and the current model onto the final message", async () => {
    mockFetch.mockResolvedValueOnce(normalStream("Hi", 111, 222));

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    expect(result.current.messages[1]).toMatchObject({
      inputTokens: 111,
      outputTokens: 222,
      model: DEFAULT_MODEL_ID,
      streaming: false,
    });
  });

  it("sends the selected model and provider to the backend", async () => {
    mockFetch.mockResolvedValueOnce(normalStream());

    const { result } = renderHook(() => useChat());
    const openai = result.current.models.find((m) => m.provider === "openai")!;

    act(() => {
      result.current.setSelectModel(openai);
    });
    await act(async () => {
      await result.current.handleSend("hi");
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe(openai.id);
    expect(body.provider).toBe("openai");
    // 只发 role/content，不把 id、timestamp、token 这些本地字段泄漏给 AI——
    // 它们不参与推理，白白占 input token
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("ignores a second handleSend while one is still in flight", async () => {
    let releaseFetch!: (value: unknown) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseFetch = resolve;
      }),
    );

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.handleSend("first");
    });
    act(() => {
      result.current.handleSend("second"); // 应被 isLoading 守卫拦下
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toHaveLength(2);

    await act(async () => {
      releaseFetch(normalStream());
    });
  });
});

// ═════════════════════════════════════════════════════════════
describe("useChat — cancelling mid-stream (AbortController)", () => {
  it("keeps the generated content and appends a stop marker", async () => {
    mockFetch = abortableFetch();
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.handleSend("Write a long essay");
    });

    await act(async () => {
      result.current.handleStop();
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].content).toContain(STOP_MARKER);
    // 停止之后必须退出 loading，否则输入框会永久禁用
    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages[1].streaming).toBe(false);
  });

  it("does not treat a user-initiated stop as an error", async () => {
    mockFetch = abortableFetch();
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.handleSend("hi");
    });
    await act(async () => {
      result.current.handleStop();
    });

    // AbortError 必须在 catch 里被单独识别并提前 return，
    // 否则会掉进通用错误分支，用户主动点停止却收到"出错了"
    expect(result.current.messages[1].content).not.toContain("went wrong");
  });

  it("can send again after a cancellation", async () => {
    mockFetch = abortableFetch();
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.handleSend("first");
    });
    await act(async () => {
      result.current.handleStop();
    });

    // 换回正常的 fetch，验证 abortControllerRef 已经在 finally 里清干净
    mockFetch.mockResolvedValueOnce(normalStream("Back to normal"));
    await act(async () => {
      await result.current.handleSend("second");
    });

    expect(result.current.messages).toHaveLength(4);
    expect(result.current.messages[3].content).toBe("Back to normal");
  });
});

// ═════════════════════════════════════════════════════════════
describe("useChat — conversation branching", () => {
  /** 先跑完一轮完整问答，返回渲染结果，供分支测试作为起点 */
  async function seedOneExchange(answer = "First answer") {
    mockFetch.mockResolvedValueOnce(normalStream(answer));
    const rendered = renderHook(() => useChat());
    await act(async () => {
      await rendered.result.current.handleSend("Original question");
    });
    return rendered;
  }

  it("drops every message after an edited one and re-asks", async () => {
    const { result } = await seedOneExchange("Old answer");
    expect(result.current.messages).toHaveLength(2);

    mockFetch.mockResolvedValueOnce(normalStream("New answer"));
    const target = result.current.messages[0];

    act(() => {
      result.current.startEditing(target);
    });
    act(() => {
      result.current.setEditingText("Edited question");
    });
    await act(async () => {
      result.current.saveEditMessage(target.id);
    });

    // 仍然是 2 条：旧答案被 slice 截掉了，而不是追加在后面
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe("Edited question");
    expect(result.current.messages[1].content).toBe("New answer");

    // 重发时带的历史里不能再出现旧答案，否则 AI 会看到自己没说过的话
    const resendBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(resendBody.messages).toEqual([
      { role: "user", content: "Edited question" },
    ]);
  });

  it("leaves edit mode after saving", async () => {
    const { result } = await seedOneExchange();
    mockFetch.mockResolvedValueOnce(normalStream());
    const target = result.current.messages[0];

    act(() => {
      result.current.startEditing(target);
    });
    expect(result.current.editingId).toBe(target.id);

    await act(async () => {
      result.current.saveEditMessage(target.id);
    });
    expect(result.current.editingId).toBeNull();
    expect(result.current.editingText).toBe("");
  });

  it("does not save an edit that is only whitespace", async () => {
    const { result } = await seedOneExchange();
    const target = result.current.messages[0];

    act(() => {
      result.current.startEditing(target);
    });
    act(() => {
      result.current.setEditingText("   "); // 纯空格
    });
    await act(async () => {
      result.current.saveEditMessage(target.id);
    });

    // 不该发起第二次请求，消息也不该变
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.messages[0].content).toBe("Original question");
  });

  it("replaces the last answer on regenerate instead of appending one", async () => {
    const { result } = await seedOneExchange("First attempt");
    mockFetch.mockResolvedValueOnce(normalStream("Second attempt"));

    await act(async () => {
      result.current.handleRegenerate();
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe("Original question");
    expect(result.current.messages[1].content).toBe("Second attempt");
  });

  it("is a no-op to regenerate when there is no answer yet", async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      result.current.handleRegenerate();
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════
describe("useChat — error handling and information safety", () => {
  it("shows a 4xx error message verbatim (trusted source)", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse("Message too long: 5000 characters (limit 4000)."),
    );

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("a very long message");
    });

    expect(result.current.messages[1].content).toBe(
      "Message too long: 5000 characters (limit 4000).",
    );
  });

  it("shows an in-stream error event verbatim as well", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([
        sse({
          error: "Gemini free quota exceeded. Please wait and try again later.",
        }),
      ]),
    );

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    expect(result.current.messages[1].content).toContain("free quota exceeded");
  });

  it("never leaks internal details from an unexpected exception", async () => {
    // 这是整组测试里最重要的一条：防信息泄漏（information disclosure）。
    // 未预期的异常可能带栈、内部 endpoint、连接串，绝不能出现在气泡里。
    mockFetch.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 10.0.3.14:5432 — internal-db.prod.local"),
    );

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    const shown = result.current.messages[1].content;
    expect(shown).toBe(GENERIC_ERROR);
    expect(shown).not.toContain("ECONNREFUSED");
    expect(shown).not.toContain("internal-db");
  });

  it("falls back to the generic message when a non-2xx body is not JSON", async () => {
    // 网关返回 HTML 502 页面时 response.json() 会抛错
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    expect(result.current.messages[1].content).toBe(GENERIC_ERROR);
  });

  it("resets isLoading after a failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    // finally 块的职责：任何路径下都不能把输入框永久锁死
    expect(result.current.isLoading).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════
describe("useChat — persistence", () => {
  it("guest: writes the completed exchange to localStorage", async () => {
    mockFetch.mockResolvedValueOnce(normalStream("Saved answer"));

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    const stored = storedConversations();
    expect(stored).toHaveLength(1);
    expect(stored[0].messages).toHaveLength(2);
    expect(stored[0].messages[1]).toMatchObject({
      content: "Saved answer",
      inputTokens: 12,
      outputTokens: 34,
      model: DEFAULT_MODEL_ID,
    });
  });

  it("guest: never calls any conversation API", async () => {
    mockFetch.mockResolvedValueOnce(normalStream());

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(["/api/chat-stream"]);
  });

  it("signed in: POSTs to the messages endpoint and leaves localStorage untouched", async () => {
    mockSessionStatus = "authenticated";

    mockFetch.mockImplementation(
      async (url: string, init?: { method?: string }) => {
        if (url === "/api/conversations" && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              id: "conv-1",
              title: "New Conversation",
              messages: [],
            }),
          };
        }
        if (url === "/api/conversations") {
          return { ok: true, json: async () => [] };
        }
        if (url === "/api/chat-stream") return normalStream("Cloud answer");
        return { ok: true, json: async () => ({}) };
      },
    );

    const { result } = renderHook(() => useChat());
    await act(async () => {}); // 冲掉 mount 时拉取会话列表的 effect

    await act(async () => {
      await result.current.handleSend("hi");
    });

    const saveCall = mockFetch.mock.calls.find(
      ([url]) => url === "/api/conversations/conv-1/messages",
    );
    expect(saveCall).toBeDefined();
    expect(JSON.parse(saveCall![1].body).messages).toHaveLength(2);
    // 登录用户的数据只进数据库，不该在浏览器里留一份
    expect(localStorage.getItem("conversations")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════
describe("useChat — conversation management", () => {
  it("clears activeConvId after deleting the active conversation", async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleNewChat();
    });
    const convId = result.current.activeConvId!;
    expect(convId).toBeTruthy();

    await act(async () => {
      await result.current.handleDeleteConv(convId);
    });

    expect(result.current.conversations).toHaveLength(0);
    expect(result.current.activeConvId).toBeNull();
  });

  it("persists a rename to localStorage", async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleNewChat();
    });
    await act(async () => {
      await result.current.handleRenameConv(
        result.current.activeConvId!,
        "My new title",
      );
    });

    expect(result.current.conversations[0].title).toBe("My new title");
    expect(storedConversations()[0].title).toBe("My new title");
  });

  it("moves a conversation to the top when it receives a new message", async () => {
    // ⚠️ 这个测试必须用假时钟。
    // 排序依据是 updatedAt 倒序，而测试跑得比毫秒时钟还快——两个会话很可能
    // 落在同一毫秒，比较结果为 0；JS 的 Array.sort 是稳定排序（stable sort），
    // 返回 0 时保持原有相对顺序，断言就会随机失败（实测三次挂两次）。
    // 把时间变成显式输入，这个测试才只验证排序逻辑本身。
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    try {
      const { result } = renderHook(() => useChat());

      // 建两个会话；handleNewChat 是往前插，所以此刻顺序是 [B, A]
      await act(async () => {
        await result.current.handleNewChat();
      });
      const convA = result.current.activeConvId!;

      jest.setSystemTime(new Date("2026-01-01T00:00:01Z"));
      await act(async () => {
        await result.current.handleNewChat();
      });
      const convB = result.current.activeConvId!;
      expect(result.current.conversations.map((c) => c.id)).toEqual([
        convB,
        convA,
      ]);

      // 切回 A 并发一条消息 —— setMessages 会按 updatedAt 倒序重排
      jest.setSystemTime(new Date("2026-01-01T00:00:02Z"));
      act(() => {
        result.current.setActiveConvId(convA);
      });
      mockFetch.mockResolvedValueOnce(normalStream());
      await act(async () => {
        await result.current.handleSend("A message in conversation A");
      });

      expect(result.current.conversations.map((c) => c.id)).toEqual([
        convA,
        convB,
      ]);
    } finally {
      // finally 保证即使断言失败也会还原真实时钟，
      // 否则后面所有用到定时器的测试都会被连累
      jest.useRealTimers();
    }
  });

  it("handleClear empties the messages and raises the cleared flag", async () => {
    mockFetch.mockResolvedValueOnce(normalStream());
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });
    expect(result.current.messages).toHaveLength(2);

    act(() => {
      result.current.handleClear();
    });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.cleared).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// 登录态走的是完全另一条代码路径（写数据库而不是写 localStorage）。
// 这里的漏测最贵——写错了就是真实数据丢失，而不是刷新一下就能恢复。
// ═════════════════════════════════════════════════════════════
describe("useChat — conversation management when signed in", () => {
  /** 把已存在的会话喂给 mount 时的列表拉取，省去逐个新建 */
  function mockApi(existing: unknown[] = []) {
    return jest.fn(async (url: string, init?: { method?: string }) => {
      if (url === "/api/conversations" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            id: "conv-new",
            title: "New Conversation",
            messages: [],
          }),
        };
      }
      if (url === "/api/conversations") {
        return { ok: true, json: async () => existing };
      }
      return { ok: true, json: async () => ({}) };
    });
  }

  beforeEach(() => {
    mockSessionStatus = "authenticated";
  });

  it("loads the conversation list on mount and rehydrates timestamps into Date objects", async () => {
    mockFetch = mockApi([
      {
        id: "c1",
        title: "An older conversation",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        messages: [
          {
            id: "m1",
            role: "user",
            content: "A message from history",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ]);
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    await act(async () => {});

    expect(result.current.conversations).toHaveLength(1);
    // JSON 只有字符串，时间戳必须显式复水（rehydrate）成 Date，
    // 否则 UI 里的 timestamp.toLocaleTimeString() 会直接报错
    expect(result.current.conversations[0].messages[0].timestamp).toBeInstanceOf(
      Date,
    );
  });

  it("creates a conversation via POST and adopts the server-issued id", async () => {
    mockFetch = mockApi();
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    await act(async () => {});
    await act(async () => {
      await result.current.handleNewChat();
    });

    expect(result.current.activeConvId).toBe("conv-new");
    // id 必须由服务端给，不能前端 randomUUID 后再指望数据库认——
    // 那样前后端会各持一个 id，后续 PATCH/DELETE 全部落空
    expect(localStorage.getItem("conversations")).toBeNull();
  });

  it("renames via PATCH and syncs local state", async () => {
    mockFetch = mockApi();
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    await act(async () => {});
    await act(async () => {
      await result.current.handleNewChat();
    });
    await act(async () => {
      await result.current.handleRenameConv("conv-new", "Renamed");
    });

    const patch = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/conversations/conv-new" && init?.method === "PATCH",
    );
    expect(patch).toBeDefined();
    expect(JSON.parse(patch![1].body)).toEqual({ title: "Renamed" });
    expect(result.current.conversations[0].title).toBe("Renamed");
  });

  it("deletes via DELETE and removes it from the list", async () => {
    mockFetch = mockApi();
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    await act(async () => {});
    await act(async () => {
      await result.current.handleNewChat();
    });
    await act(async () => {
      await result.current.handleDeleteConv("conv-new");
    });

    const del = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/conversations/conv-new" && init?.method === "DELETE",
    );
    expect(del).toBeDefined();
    expect(result.current.conversations).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════
describe("useChat — guards and edge cases", () => {
  it("does not send a request for blank input", async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("   ");
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("treats an ok response with no body as an error", async () => {
    // 网关或代理偶尔会回一个 200 空响应；没有这条守卫，
    // response.body.getReader() 会抛 TypeError，掉进通用错误分支还算走运，
    // 更糟的是留下一条永远 streaming 的消息
    mockFetch.mockResolvedValueOnce({ ok: true, body: null });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("hi");
    });

    expect(result.current.messages[1].content).toBe(GENERIC_ERROR);
    expect(result.current.messages[1].streaming).toBe(false);
  });

  it("cancelling an edit clears the edit state and leaves the content alone", async () => {
    mockFetch.mockResolvedValueOnce(normalStream());
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("Original text");
    });

    act(() => {
      result.current.startEditing(result.current.messages[0]);
    });
    act(() => {
      result.current.setEditingText("Half-typed change");
    });
    act(() => {
      result.current.cancelEditMessage();
    });

    expect(result.current.editingId).toBeNull();
    expect(result.current.editingText).toBe("");
    expect(result.current.messages[0].content).toBe("Original text");
  });

  it("refuses to enter edit mode while a response is streaming", async () => {
    let releaseFetch!: (value: unknown) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseFetch = resolve;
      }),
    );

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.handleSend("hi");
    });

    act(() => {
      result.current.startEditing(result.current.messages[0]);
    });
    // 正在生成时改问题会让"已发出的历史"和"界面显示的历史"对不上
    expect(result.current.editingId).toBeNull();

    await act(async () => {
      releaseFetch(normalStream());
    });
  });
});

// ═════════════════════════════════════════════════════════════
describe("useChat — reactions", () => {
  it("adds a like, then toggles it off", () => {
    const { result } = renderHook(() => useChat());

    act(() => {
      result.current.handleReaction("m1", "likes");
    });
    expect(result.current.reactions["m1"]).toEqual({
      likes: 1,
      dislikes: 0,
      userVote: "likes",
    });

    act(() => {
      result.current.handleReaction("m1", "likes");
    });
    expect(result.current.reactions["m1"]).toEqual({
      likes: 0,
      dislikes: 0,
      userVote: null,
    });
  });

  it("removes the like when switching to a dislike (mutually exclusive)", () => {
    const { result } = renderHook(() => useChat());

    act(() => {
      result.current.handleReaction("m1", "likes");
    });
    act(() => {
      result.current.handleReaction("m1", "dislikes");
    });

    expect(result.current.reactions["m1"]).toEqual({
      likes: 0,
      dislikes: 1,
      userVote: "dislikes",
    });
  });
});

// ═════════════════════════════════════════════════════════════
// 这两组曾经是"当前行为快照"——记录两个已知缺陷，等着被修。
// 2026-08-05 已修复，断言随之翻面，现在是防回归（regression）测试。
// 两个缺陷同源：handleSend 里读了只在**下一次渲染**才更新的 state。
// ═════════════════════════════════════════════════════════════
describe("useChat — auto-title from the first message", () => {
  it("sets the title from the first message of a new conversation", async () => {
    mockFetch.mockResolvedValueOnce(normalStream());

    const { result } = renderHook(() => useChat());
    // 刻意用 24 字符以内的问题，好和下面那条"超长要截断"的用例分开——
    // 这条只验证"标题有没有被设上"，不该被截断规则干扰
    await act(async () => {
      await result.current.handleSend("What is a closure?");
    });

    // 会话是在这次 handleSend 内部现建的，闭包里的 activeConversation /
    // activeConvId 都还是空——判断和匹配都必须改用本次调用算出的 convId。
    expect(result.current.conversations[0].title).toBe("What is a closure?");
  });

  it("truncates a title longer than 24 characters and appends an ellipsis", async () => {
    mockFetch.mockResolvedValueOnce(normalStream());
    const long = "This question is definitely longer than twenty-four characters";

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend(long);
    });

    expect(result.current.conversations[0].title).toBe(
      long.slice(0, 24) + "...",
    );
  });

  it("only sets the title once — the second message does not overwrite it", async () => {
    mockFetch.mockResolvedValueOnce(normalStream("First answer"));
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("First sentence");
    });

    mockFetch.mockResolvedValueOnce(normalStream("Second answer"));
    await act(async () => {
      await result.current.handleSend("Second sentence");
    });

    // 用 baseMessages.length === 0 判断而不是"会话是不是刚建的"，
    // 好处正是这里：第二条消息时历史非空，分支自然不进。
    expect(result.current.conversations[0].title).toBe("First sentence");
  });

  it("leaves the title alone on edit-resend and regenerate", async () => {
    mockFetch.mockResolvedValueOnce(normalStream("Original answer"));
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.handleSend("Original question");
    });
    expect(result.current.conversations[0].title).toBe("Original question");

    // 这两条路径都以 shouldAddUserMessage=false 调用 handleSend，
    // 是"重发已有的话"而不是"开启新话题"，标题应当保持不变。
    mockFetch.mockResolvedValueOnce(normalStream("New answer"));
    await act(async () => {
      result.current.handleRegenerate();
    });

    expect(result.current.conversations[0].title).toBe("Original question");
  });

  it("signed in: also PATCHes the title to the server", async () => {
    mockSessionStatus = "authenticated";
    mockFetch.mockImplementation(
      async (url: string, init?: { method?: string }) => {
        if (url === "/api/conversations" && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              id: "conv-1",
              title: "New Conversation",
              messages: [],
            }),
          };
        }
        if (url === "/api/conversations") {
          return { ok: true, json: async () => [] };
        }
        if (url === "/api/chat-stream") return normalStream();
        return { ok: true, json: async () => ({}) };
      },
    );

    const { result } = renderHook(() => useChat());
    await act(async () => {}); // 冲掉 mount 时拉取会话列表的 effect
    await act(async () => {
      await result.current.handleSend("First cloud message"); // 24 字符以内，不触发截断
    });

    // 只改本地 state 不够：侧边栏的标题下次刷新是从数据库读回来的。
    const patch = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/conversations/conv-1" && init?.method === "PATCH",
    );
    expect(patch).toBeDefined();
    expect(JSON.parse(patch![1].body)).toEqual({
      title: "First cloud message",
    });
  });
});

// ═════════════════════════════════════════════════════════════
describe("useChat — persistence after stopping mid-stream", () => {
  it("guest: writes the partial content to localStorage", async () => {
    mockFetch = abortableAfterChunk("Half of the answer was written");
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.handleSend("Write a long essay");
    });
    await act(async () => {
      result.current.handleStop();
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].content).toContain(STOP_MARKER);

    // 关键：存下来的不能是"标题还在、messages 为空"的空壳。
    // 停止是用户的主动选择，已生成的内容是要留下的成果。
    const stored = storedConversations();
    expect(stored).toHaveLength(1);
    expect(stored[0].messages).toHaveLength(2);
    expect(stored[0].messages[0].content).toBe("Write a long essay");
    expect(stored[0].messages[1].content).toContain(
      "Half of the answer was written",
    );
    expect(stored[0].messages[1].content).toContain(STOP_MARKER);
    // 首条消息的标题同样要落盘，否则刷新后又变回 New Conversation
    expect(stored[0].title).toBe("Write a long essay");
  });

  it("signed in: POSTs the partial content to the messages endpoint", async () => {
    mockSessionStatus = "authenticated";
    const streamFetch = abortableAfterChunk("Half written in the cloud");
    mockFetch = jest.fn(
      async (url: string, init?: { method?: string; signal?: AbortSignal }) => {
        if (url === "/api/conversations" && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              id: "conv-1",
              title: "New Conversation",
              messages: [],
            }),
          };
        }
        if (url === "/api/conversations") {
          return { ok: true, json: async () => [] };
        }
        if (url === "/api/chat-stream") {
          return streamFetch(url, init as { signal: AbortSignal });
        }
        return { ok: true, json: async () => ({}) };
      },
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    await act(async () => {});
    act(() => {
      result.current.handleSend("Write a long essay");
    });
    // 登录路径在发起流式请求**之前**还要 await 两次网络往返（新建会话 POST、
    // 标题 PATCH），此刻 abortControllerRef 还是 null，直接 handleStop 会打空。
    // 先把这些微任务冲干净，再停止。
    await act(async () => {});

    await act(async () => {
      result.current.handleStop();
    });

    const saveCall = mockFetch.mock.calls.find(
      ([url]) => url === "/api/conversations/conv-1/messages",
    );
    expect(saveCall).toBeDefined();
    const saved = JSON.parse(saveCall![1].body).messages;
    expect(saved).toHaveLength(2);
    expect(saved[1].content).toContain("Half written in the cloud");
    // 登录用户的数据只进数据库，不该在浏览器里留一份
    expect(localStorage.getItem("conversations")).toBeNull();
  });

  it("does not lose the tail that the throttle had not flushed yet", async () => {
    // flushAssistantMessage 有 40ms 节流，界面上可能只显示到第一个字符；
    // 但落盘用的是 assistantContent 这个本地累加变量，必须是完整的。
    mockFetch = abortableAfterChunk("The complete ten-word answer body");
    global.fetch = mockFetch as unknown as typeof fetch;

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.handleSend("hi");
    });
    await act(async () => {
      result.current.handleStop();
    });

    expect(storedConversations()[0].messages[1].content).toBe(
      `The complete ten-word answer body\n\n${STOP_MARKER}`,
    );
  });
});
