# syntax=docker/dockerfile:1

# ============================================================
# Stage 1: deps —— 只负责安装依赖（为了最大化利用分层缓存）
# ============================================================
FROM node:22-alpine AS deps
# Next.js 在 alpine 上运行需要的 glibc 兼容垫片
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 只复制「依赖清单」两个文件（其余源码留到 builder 阶段再复制，
# 这样改源码时不会让下面的 npm ci 缓存失效）
COPY package.json package-lock.json ./

# 严格按 lock 文件可复现安装
RUN npm ci

# ============================================================
# Stage 2: builder —— prisma generate + next build
# ============================================================
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 从 deps 阶段把装好的 node_modules 捞过来（用 COPY --from=...）   
COPY --from=deps /app/node_modules ./node_modules

# 复制全部源码到镜像。
COPY . .

# 关闭 Next.js 匿名遥测（可选，纯配置，直接给）
ENV NEXT_TELEMETRY_DISABLED=1

# 重新生成 Prisma client（src/generated/prisma 被 gitignore，必须现生）
RUN npx prisma generate

# 执行 Next.js 生产构建（会产出 .next/standalone）
RUN npx next build


# ============================================================
# Stage 3: runner —— 最终精简运行镜像
# ============================================================
FROM node:22-alpine AS runner
WORKDIR /app

# 生产环境标识（让框架走生产分支：关 dev 工具、开优化等）
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 安全：创建一个非 root 用户来跑应用（容器默认用 root，被攻破风险大）
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone 的正确捞法（3 条）：
# ① 自包含运行包（含精简 node_modules + server.js），捞到 /app 根目录
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# ② 静态 chunk（nft 追踪不到，必须单独捞）
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# ③ public 静态资源（图片等，也追踪不到）
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 切换到非 root 用户运行
USER nextjs

# 声明端口 + 让 standalone server 监听所有网卡（关键，否则容器外连不上）
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 启动 standalone 自带的最小化服务器
CMD ["node", "server.js"]
