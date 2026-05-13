# 🤖 AI Chat

A production-style AI chat web app built with **Next.js 16**, **React 19**, and **Google Gemini 2.5 Flash**.  
Designed to simulate the architecture and UX patterns used in real AI products like ChatGPT and Claude.

---

## ✨ Features

### Core Chat
- **Real-time streaming** — Character-by-character output via SSE (Server-Sent Events)
- **Multi-turn context** — Maintains conversation history with a sliding window (last 10 turns)
- **Typing effect** — Smooth 20ms/character render with 40ms throttle on state updates
- **Stop generation** — Cancel mid-stream with `AbortController`
- **Regenerate** — Re-run the last AI response with one click

### Message UX
- **Edit messages** — Modify any past message and regenerate from that point (conversation branching)
- **Copy** — Copy message content or code blocks to clipboard
- **Reactions** — Like / dislike toggle with count display
- **Auto-scroll** — Always keeps the latest message in view

### Markdown & Code
- Full **GitHub-Flavored Markdown** rendering (tables, lists, bold, inline code)
- **Syntax highlighting** with language detection
- **Colored language badges** — JS, TS, PY, HTML, CSS, etc.
- One-click **copy code** button with copied state feedback

### Persistence
- Chat history saved to **localStorage** after stream ends
- Debounced saves (300ms) to avoid excessive writes
- Conversation restored automatically on page refresh

---

## 🛠 Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| AI Model | Google Gemini 2.5 Flash |
| Streaming | Server-Sent Events (SSE) |
| Markdown | react-markdown + remark-gfm |
| Syntax Highlighting | react-syntax-highlighter (oneDark) |
| Icons | Font Awesome |
| Styling | Pure CSS with CSS Variables + Tailwind 4 |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com) API key

### Installation

```bash
git clone https://github.com/spencertyy/AI-Chat.git
cd AI-Chat/typescript
npm install
```

### Environment Variables

Create a `.env.local` file in the `typescript/` directory:

```
GEMINI_API_KEY=your_key_here
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📁 Project Structure

```
src/
├── app/
│   ├── page.tsx              # Main chat UI and all logic
│   ├── globals.css           # All styles (CSS variables)
│   ├── tokens.css            # Design tokens (colors, radius, shadows)
│   └── api/
│       └── chat-stream/
│           └── route.ts      # Gemini SSE streaming endpoint
```

---

## 🏗 Architecture

### Streaming Flow

```
User input → POST /api/chat-stream
           → Gemini generateContentStream
           → SSE chunks → TextDecoder → buffer parsing
           → Character-by-character render (20ms/char)
           → [DONE] → save to localStorage
```

### Conversation Branching

Editing a past message removes all subsequent responses and rebuilds  
the conversation context from the edited point — the same pattern used in ChatGPT.

---

## 📌 Planned

- [ ] Sidebar with multiple conversations
- [ ] Image upload (Gemini multimodal)
- [ ] File upload support
- [ ] Multi-model support (OpenAI / Gemini switchable)
- [ ] Mobile optimization
- [ ] Theme toggle (light / dark)

---

## 📄 License

MIT
