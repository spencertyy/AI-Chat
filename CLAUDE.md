# AI Chat — Project Guide

## 项目概述

基于 Next.js 16 + React 19 + TypeScript 的 AI 聊天应用，使用 Google Gemini 2.5 Flash 作为后端模型，通过 SSE（Server-Sent Events）实现流式输出。

## 技术栈

- **框架**: Next.js 16，开启了 React Compiler (`reactCompiler: true`)
- **AI**: `@google/genai` SDK，模型 `gemini-2.5-flash`
- **UI**: 纯 CSS（CSS 变量 + Tailwind 4），无 UI 组件库
- **Markdown**: `react-markdown` + `remark-gfm` + `react-syntax-highlighter`

## 关键文件

| 文件 | 说明 |
|------|------|
| `src/app/page.tsx` | 主页面，所有聊天逻辑（单文件） |
| `src/app/api/chat-stream/route.ts` | **主接口**：SSE 流式对话 |
| `src/app/api/chat/route.ts` | 旧接口：非流式，暂未使用 |
| `src/app/globals.css` | 所有样式（基于 CSS 变量） |
| `src/app/tokens.css` | 设计 token（颜色、圆角、阴影） |

## 环境变量

`.env.local` 中需配置：

```
GEMINI_API_KEY=your_key_here
```

> `api/chat/route.ts` 里用的是 `GOOGLE_API_KEY`（旧版，已废弃）

## 开发命令

```bash
npm run dev    # 启动开发服务器，默认 http://localhost:3000
npm run build  # 生产构建
npm run lint   # ESLint 检查
```

## 架构说明

### 流式输出流程

1. 前端 `handleSend()` → POST `/api/chat-stream`
2. 后端用 Gemini SDK `generateContentStream` 生成 SSE 事件
3. 前端逐字符（20ms/字）渲染，模拟打字效果
4. 收到 `[DONE]` 后结束流，`streaming: false`

### 消息上下文

- 取最近 10 轮（20 条）消息拼接成纯文本 prompt
- 历史保存在 `localStorage`（key: `"chat-history"`）
- 刷新页面后自动恢复对话

### 主要 UI 功能

- **Edit**：点击用户消息的 ✎ 按钮，修改后重新发送，截断后续历史
- **Regenerate**：重新生成最后一条 AI 回复
- **Stop**：AbortController 中止流式请求
- **Clear**：清空对话 + localStorage

## 样式规范

- 所有颜色、圆角、阴影从 `tokens.css` 的 CSS 变量取，**不要硬编码**
- 深色主题，无浅色模式
- 新增组件样式写在 `globals.css` 末尾，用注释分区

## 注意事项

- `api/chat/route.ts` 中有一个无用的 `import { Parts } from "openai/..."` 应在清理时移除
- 前端逐字符渲染（20ms 延迟）会累积大量 `setMessages` 调用，长回复时有性能开销——未来可改为批量更新
- `page.tsx` 当前为单文件，待功能稳定后计划拆分组件（见 memory 中的重构计划）
