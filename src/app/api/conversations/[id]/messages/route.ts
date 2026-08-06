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

  const { messages }: { messages: IncomingMessage[] } = await req.json();
  const { id } = await params;

  // 先删除该对话的所有旧消息，再全量写入，防止重复积累
  //Delete all the old messages in this conversation and then write them all in full to prevent repeated accumulation
  await prisma.message.deleteMany({ where: { conversationId: id } });

  const result = await prisma.message.createMany({
    data: messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      conversationId: id,
      inputTokens: msg.inputTokens ?? null,
      outputTokens: msg.outputTokens ?? null,
      model: msg.model ?? null,
    })),
  });
  return NextResponse.json(result);
}
