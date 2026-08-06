import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { summarizeUsage } from "@/app/lib/usage";

// GET /api/usage — 当前用户的累计 token 用量与费用
//
// 只服务登录用户。游客的数据在浏览器 localStorage 里，服务端根本看不到，
// 由 UsagePanel 在客户端自己汇总（同样调 summarizeUsage，保证两边算法一致）。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 为什么用 groupBy 而不是 findMany 之后在 JS 里 reduce：
  // 费用必须按模型分别计价，而"每个模型的 token 总数"正好是数据库最擅长的聚合。
  // 用户聊了几千条消息时，groupBy 只回来七八行（模型数量级），
  // findMany 则要把全部消息正文一起传回来——正文才是这张表里最大的字段。
  //
  // Message 表没有 userId 字段，归属关系是 Message → Conversation → User，
  // 所以这里用关系过滤 conversation: { userId }，Prisma 会翻译成 JOIN。
  // 这一行同时就是越权防护：任何情况下都只能聚合到自己的对话。
  const grouped = await prisma.message.groupBy({
    by: ["model"],
    where: { conversation: { userId: user.id }, role: "assistant" },
    _sum: { inputTokens: true, outputTokens: true },
  });

  const summary = summarizeUsage(
    grouped.map((row) => ({
      model: row.model,
      inputTokens: row._sum.inputTokens,
      outputTokens: row._sum.outputTokens,
    }))
  );

  return NextResponse.json(summary);
}
