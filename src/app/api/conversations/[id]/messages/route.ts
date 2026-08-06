import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// 客户端 POST 上来的消息形状。
//
// ⚠️ 这只是**类型声明**，不是运行时校验——TypeScript 的类型在编译后就消失了，
// 拿到的仍然是 req.json() 解析出的任意 JSON。写成具体类型的价值在于让下面的
// map 有自动补全和拼写检查，以及把"我们期望收到什么"写进代码。
// 真正的输入校验（例如 zod）是另一件事，见下方 TODO。
type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  model?: string | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // ── 授权（authorization）：光有 session 只证明"你是某个已登录用户"，
  // 不证明"这条对话是你的"。[id] 完全由客户端控制，不校验归属就直接拿去
  // deleteMany，等于任何登录用户都能抹掉别人的对话历史（IDOR）。
  // 与 ../route.ts 的 DELETE / PATCH 保持同一套模式：先查 user，再按 userId 收窄。
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // findFirst 而非 findUnique：findUnique 的 where 只接受唯一索引字段，
  // userId 不是唯一的，塞不进去；复合归属条件必须走 findFirst。
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!conversation) {
    // 故意用 404 而不是 403。403 等于承认"这个 id 存在，只是不归你"，
    // 攻击者可以据此枚举出系统里真实存在的对话 id。统一 404 让
    // "不存在"和"不是你的"在响应上无法区分。
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  const { messages }: { messages: IncomingMessage[] } = await req.json();

  // 先删除该对话的所有旧消息，再全量写入，防止重复积累
  //Delete all the old messages in this conversation and then write them all in full to prevent repeated accumulation
  //
  // 两条语句包在一个事务里：否则 createMany 失败时，旧消息已经删了、新消息
  // 没写进去，对话会永久变成空的。事务保证要么都生效、要么整体回滚。
  const [, result] = await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: id } }),
    prisma.message.createMany({
      data: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        conversationId: id,
        inputTokens: msg.inputTokens ?? null,
        outputTokens: msg.outputTokens ?? null,
        model: msg.model ?? null,
      })),
    }),
  ]);
  return NextResponse.json(result);
}
