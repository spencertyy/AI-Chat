import { prisma } from "@/lib/prisma";

// 公开 demo 的两层限流。
//
// 第 1 层（每 IP / 小时）保证公平分配——一个人刷不掉所有人的额度。
// 第 2 层（全站 / 天）是保险丝——就算有人轮换 IP 绕过第 1 层，
// 总消耗也封死在这个数上。两层缺一不可：
//   只有第 1 层 → 换 IP 就破了，没有上限
//   只有第 2 层 → 一个人一分钟就能把全天额度用光
//
// 算法用固定窗口（fixed window）。已知缺陷是边界突刺：卡在整点前后
// 可以打出两倍限额。这里接受这个缺陷，因为第 2 层已经封死了总量，
// 突刺只是让配额消耗得快一点，不会突破任何硬上限。换滑动窗口要
// 每请求存一行 + 时间范围查询，为一个不造成实际损失的问题付三倍复杂度。

export const IP_LIMIT = 8; // 每个 IP 每小时
export const GLOBAL_LIMIT = 300; // 全站每天

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * 把任意时刻向下取整到所属窗口的起点。
 *
 * 为什么必须对齐：如果直接存请求发生的时间，同一小时内的每次请求
 * 都会生成不同的 windowStart，也就是不同的行，计数永远是 1。
 * 对齐之后同一窗口内所有请求命中同一行，才能累加。
 *
 * 例：10:37:22 在小时窗口下 → 10:00:00
 */
function getWindowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** 从 Vercel 注入的 header 里取访客真实 IP。 */
export function getClientIp(headers: Headers): string {
  // x-forwarded-for 是一条代理链，格式为 "客户端IP, 代理1, 代理2"，
  // 第一个才是真实来源。直连时该 header 不存在，回退到 x-real-ip。
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/**
 * 检查某个 key 在当前窗口是否还有额度；有则消耗一次。
 *
 * @param key      限流对象。IP 用 `ip:1.2.3.4`，全局用 `global`
 * @param limit    该窗口允许的最大次数
 * @param windowMs 窗口长度（毫秒）
 * @returns        true = 还有额度且已消耗；false = 已超限
 *
 * 用 upsert 而不是「先查再写」：upsert 把「不存在就插入、存在就 +1」
 * 编译成一条 SQL，递增由数据库原子完成。两个并发请求会被数据库排队，
 * 各自拿到 8 和 9，不会都读到 7 然后都放行——竞态从根上不存在。
 *
 * 代价是语义变成「先加再判断」：超限的请求也会让 count 继续涨。
 * 这里刻意接受，因为 count 涨过 limit 没有任何害处（判断只看 <= limit），
 * 反而留下了可观测性——当天 count 是 300 还是 5000，是完全不同的信号。
 */
export async function checkAndConsume(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const windowStart = getWindowStart(new Date(), windowMs);

  const record = await prisma.rateLimit.upsert({
    // key_windowStart 是 Prisma 为复合主键 @@id([key, windowStart])
    // 自动生成的查询字段名：把各字段名按声明顺序用下划线连起来。
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });

  // record.count 已经含了当前这一次，所以用 <= 才能正好放行 limit 次：
  // limit=8 时第 8 次请求拿到 count=8 → 放行；第 9 次拿到 9 → 拒绝。
  return record.count <= limit;
}

/** 限流检查结果。被拦下时必定带原因，用来决定给用户看哪套文案。 */
export type QuotaCheck =
  | { allowed: true }
  | { allowed: false; reason: "ip" | "global" };

/**
 * 同时检查两层限流，并回报是哪一层拦下的。
 *
 * 为什么要区分原因：两种超限对用户意味着完全不同的事。IP 超限是
 * 「你发得太快了」，一小时后恢复；全局超限是「全站今天用完了」，
 * 明天才重置。如果共用一句文案，第一次访问就撞上全局限额的人
 * 会看到「你请求太频繁」——他会当成 bug，因为他确实才发第一条。
 *
 * 注意顺序：先查全局。全局都满了就没必要再消耗 IP 额度——
 * 否则访客会在「全站已满」的情况下白白烧掉自己的每小时配额，
 * 等全局恢复时他反而没额度了。
 */
export async function checkDemoQuota(ip: string): Promise<QuotaCheck> {
  const globalOk = await checkAndConsume("global", GLOBAL_LIMIT, DAY_MS);
  if (!globalOk) return { allowed: false, reason: "global" };

  const ipOk = await checkAndConsume(`ip:${ip}`, IP_LIMIT, HOUR_MS);
  if (!ipOk) return { allowed: false, reason: "ip" };

  return { allowed: true };
}

/**
 * 删除已经过期的窗口记录，避免表无限膨胀。
 *
 * 没有单独跑定时任务——在正常请求里顺带清理就够了，
 * 这张表的增长速度是每小时每 IP 一行，本来就很慢。
 */
export async function cleanupExpired(now: Date = new Date()): Promise<void> {
  await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: new Date(now.getTime() - 2 * DAY_MS) } },
  });
}
