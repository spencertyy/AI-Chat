/**
 * @jest-environment node
 */
// 全局 testEnvironment 是 jsdom（组件测试需要 DOM）。但 route handler 是服务端
// 代码，NextResponse 依赖 Web 平台的 Request/Response，jsdom 不提供这些。
// 上面的 docblock 只对本文件把环境换成 node，不影响其它测试。

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

// ─────────────────────────────────────────────────────────────
// Mock 边界
//
// 只替换两个外部依赖：认证和数据库。handler 自身的判断顺序、状态码、
// 以及"哪些分支允许走到写库"——那正是要测的东西——一律不 mock。
//
// jest.mock 的工厂会被提升到 import 之前执行，所以工厂里不能引用外部变量；
// 这里全部在工厂内部就地 new 出 jest.fn()，下面再通过 import 进来的对象取用。
// 顺带的好处：mock 掉 @/lib/prisma 也就阻止了真实 pg 连接池被创建。
// ─────────────────────────────────────────────────────────────
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    conversation: { findFirst: jest.fn() },
    message: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// prisma 的真实类型里这些是 Prisma 的重载方法，不是 jest.Mock，
// 所以断言/设置返回值前先按测试替身的形状取一次。
const db = prisma as unknown as {
  user: { findUnique: jest.Mock };
  conversation: { findFirst: jest.Mock };
  message: { deleteMany: jest.Mock; createMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockGetServerSession = getServerSession as unknown as jest.Mock;

const OWNER = { id: "user-owner", email: "owner@example.com" };
const ATTACKER = { id: "user-attacker", email: "attacker@example.com" };
const CONVERSATION_ID = "conversation-owned-by-owner";

/** 构造一次 POST /api/conversations/[id]/messages 调用 */
function callRoute(id = CONVERSATION_ID, messages: unknown[] = [{ role: "user", content: "hi" }]) {
  const req = new Request(`http://localhost/api/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

/** 让 session 属于某个用户，并让 user 表能查到他 */
function signInAs(user: { id: string; email: string }) {
  mockGetServerSession.mockResolvedValue({ user: { email: user.email } });
  db.user.findUnique.mockResolvedValue(user);
}

/** 断言这次请求一行数据都没写 */
function expectNoWrites() {
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(db.message.deleteMany).not.toHaveBeenCalled();
  expect(db.message.createMany).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  // $transaction 的数组形态返回一个与入参等长的结果数组
  db.$transaction.mockResolvedValue([{ count: 2 }, { count: 1 }]);
});

describe("POST /api/conversations/[id]/messages", () => {
  it("rejects an unauthenticated request with 401 and writes nothing", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await callRoute();

    expect(res.status).toBe(401);
    expectNoWrites();
  });

  it("returns 404 when the conversation belongs to a different user", async () => {
    signInAs(ATTACKER);
    // 归属检查按 userId 收窄，攻击者查不到别人的对话 —— 这正是修复前缺失的一步
    db.conversation.findFirst.mockResolvedValue(null);

    const res = await callRoute();

    // 404 而不是 403：403 会确认"这个 id 存在，只是不归你",
    // 相当于给攻击者一个枚举有效对话 id 的预言机。
    expect(res.status).toBe(404);
    // 最关键的一条：删除必须发生在授权通过之后，绝不能先删再检查
    expectNoWrites();
  });

  it("scopes the ownership lookup by the caller's user id", async () => {
    signInAs(ATTACKER);
    db.conversation.findFirst.mockResolvedValue(null);

    await callRoute();

    expect(db.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CONVERSATION_ID, userId: ATTACKER.id },
      })
    );
  });

  it("returns 404 when the session's email matches no user row", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "ghost@example.com" } });
    db.user.findUnique.mockResolvedValue(null);

    const res = await callRoute();

    expect(res.status).toBe(404);
    expectNoWrites();
  });

  it("replaces the messages when the caller owns the conversation", async () => {
    signInAs(OWNER);
    db.conversation.findFirst.mockResolvedValue({ id: CONVERSATION_ID });

    const res = await callRoute(CONVERSATION_ID, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", inputTokens: 12, outputTokens: 34, model: "gemini" },
    ]);

    expect(res.status).toBe(200);
    // 删除 + 写入必须作为一个事务提交，否则 createMany 失败会留下一个空对话
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][0]).toHaveLength(2);
    expect(db.message.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
    });
    expect(db.message.createMany).toHaveBeenCalledWith({
      data: [
        {
          role: "user",
          content: "hi",
          conversationId: CONVERSATION_ID,
          inputTokens: null,
          outputTokens: null,
          model: null,
        },
        {
          role: "assistant",
          content: "hello",
          conversationId: CONVERSATION_ID,
          inputTokens: 12,
          outputTokens: 34,
          model: "gemini",
        },
      ],
    });
    // handler 返回的是 createMany 的结果（$transaction 数组的第二项）
    await expect(res.json()).resolves.toEqual({ count: 1 });
  });
});
