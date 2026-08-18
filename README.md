<div align="center">

# Unsent

**Figure out what to actually say — an AI reply strategist with distinct personas.**

Paste what they said; get a reply you can send, written in the voice of a persona you pick —
**Savage** (blunt, cuts through your excuses), **Gentle** (warm, keeps the door open), or
**Veteran** (been there, plays the tempo). Built on a fully tokenized **Retro** design system
with the accessibility rigor of a shipped product rather than a demo.

[**Live Demo**](https://ai-chat-bot-rose-nine.vercel.app) · [Docker Hub](https://hub.docker.com/r/spencertu/ai-chat)

*The public demo runs on Gemini's free tier. GPT-4o mini is disabled there to control cost,
and once the quota is spent the app streams a pre-recorded reply instead of erroring out.*

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![WCAG](https://img.shields.io/badge/WCAG-AA-success?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

<img src="AI-ChatBot.png" alt="Unsent — Retro reply-strategist UI: sidebar, persona selector, comic-bubble messages and a draft-reply window" width="920" />

</div>

---

## Why Unsent

> A few friends only call when it's falling apart. They feel in floods; I think in straight
> lines. I don't always understand the feeling — but I can always see the shape of what's
> happening, and that's what they come back for.
>
> But even a good friend fills up.
>
> Unsent is the version of me that doesn't — awake at 2am, warm enough to just listen, clear
> enough to name what's really going on, and, when you ask, the words to send back.

So it works in two modes, and picks between them by reading you: **vent** and it just listens
(in the voice of the persona you chose), then quietly offers a draft only if you want one;
**paste what they said** and it hands you the reply. No mode switch to toggle — quoting the
other person is itself the signal that you want words back.

---

## Design System

Every color, radius, shadow, font size and spacing value in the app resolves through a CSS
variable. Nothing is hardcoded — which is exactly why the entire look could be swapped from a
dark glassmorphism theme to the current **Retro** system (cream windows, coral + mustard
accents, chunky black outlines, offset hard shadows, and `○○○` retro window title bars) by
editing token *values* rather than touching components. The tokens live in a single
[`tokens.css`](src/app/tokens.css); [`globals.css`](src/app/globals.css) only consumes them.

**Type scale — 10 steps, hand-tuned rather than a fixed ratio.**
A single mathematical ratio (1.25×, 1.333×) breaks down when one scale has to serve both
dense product UI and marketing-weight display type. This scale is deliberately tight at the
small end (11–18px, where information density matters) and widens toward the display end
(24–56px, where impact matters).

**The four display steps are fluid**, sized with `clamp(min, Arem + Bvw, max)` so headings
scale continuously between viewports instead of stepping at breakpoints. The `vw` term is
mixed with `rem` on purpose — a pure `vw` value ignores the user's browser font-size setting
entirely, which fails [WCAG 1.4.4](https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html).

**Spacing scale — 14 steps on a 4pt grid**, with half-steps where the grid was too coarse.
Named after their pixel value (`--space-10` is 10px) rather than t-shirt sizes, so the
token name stays unambiguous as the scale grows.

**Icon sizing is a separate scale from the type scale.** Several `font-size` declarations in
the original CSS were really sizing emoji and icon glyphs. Folding those into the type scale
would mean that resizing an avatar perturbs body-copy proportions — two unrelated concerns
sharing one control. They were split apart.

## Accessibility

Not a checklist pass — each item below fixes a specific failure mode.

**`:focus-visible`, not `:focus`.** Focus rings appear during keyboard navigation and stay
out of the way on mouse click, so the affordance is there for the people who need it without
taxing everyone else.

**`prefers-reduced-motion` collapses to `0.01ms`, not `none`.** Setting `none` stops
`transitionend` and `animationend` from ever firing, silently breaking any logic that waits
on them. A near-zero duration is visually identical and keeps the event contract intact.

**Contrast measured against the effective composited background.** Translucent surfaces mean
a token's declared color is not the color the text actually sits on. Muted ink and status
colors were darkened from the source design until small text cleared WCAG AA (4.5:1) against
what renders, not against what the token says.

**Browser chrome matches the surface.** `<meta name="theme-color">` is set from a single
source of truth ([`themeColors.ts`](src/app/lib/themeColors.ts)) so the mobile address bar
blends into the app's Retro pink instead of showing a jarring seam.

---

## Features

### Reply personas

The product's core. Instead of one neutral assistant, you pick a **persona** that shapes both
*what* it advises and *how* it says it. The three advisor personas are **orthogonal on
strategy**, not just tone — cut losses (Savage) / keep the thread alive (Gentle) / take back
the tempo (Veteran) — so three side-by-side replies actually differ in approach, not wording.
Each reply is natural and conversational with exactly one **ready-to-send draft** you copy in a
click (the "unsent" message the whole product is named for).

The prompts were iterated over five rounds against a fixed test input (documented in
[`docs/improvement-plan.md`](docs/improvement-plan.md)): **style and strategy are written as
separate dimensions** — only style and all three sound alike; only strategy and none has a
personality. Because LLM output is sampled rather than guaranteed, a shared safety floor is
backed by a **code-level guard** ([`personaGuard.ts`](src/app/lib/personaGuard.ts)) that parses
the draft, checks banned phrases, and — critically — never lets any persona advise something
irreversible. Malformed output is validated, retried once, then degraded gracefully.

### Streaming & models

Chunk-by-chunk output over **Server-Sent Events**, with state updates throttled to 40ms so
React re-renders stay bounded regardless of token rate. Switch mid-conversation between
seven models across two providers — Gemini 3.6 Flash, 3.5 Flash, 3.5 Flash Lite, 3.1 Flash
Lite, 3 Flash (Preview), 2.5 Flash, and GPT-4o mini. The default is **Gemini 3.1 Flash
Lite**, picked for a free-tier quota of 500 requests/day where 2.5 Flash allows only 20.

Cancel mid-stream with `AbortController`; a stopped response is still persisted rather than
discarded. Regenerate the last response in one click.

### Message interaction

Edit any past message to fork the conversation from that point — subsequent turns are
discarded and context is rebuilt, the same branching model ChatGPT uses. Copy message or
code content, and react with like/dislike.

**Live streaming stats** tick during generation — elapsed seconds and an estimated token
count — then swap to the real server-reported numbers for three seconds once the stream ends.

### Markdown & code

Full GitHub-Flavored Markdown (tables, lists, inline code) with syntax-highlighted fenced
blocks, language detection, colored language badges, and a copy button with confirmation state.
The highlighter theme (`oneDark` / `oneLight`) follows the app theme.

### Conversations & persistence

Multi-conversation sidebar with search, inline rename, and a mobile overlay drawer.
Signed-in users get history persisted to **PostgreSQL** and restored server-side on refresh.
**Signed-out users can chat immediately** — history falls back to `localStorage`, no login wall.

### Cost visibility

A usage panel aggregates token spend per model with real pricing
([`pricing.ts`](src/app/lib/pricing.ts)) — for signed-in users from Postgres, for guests
from `localStorage` — and API-side guardrails cap runaway cost.

### Public demo guardrails

A deployed demo is an open AI proxy. No key leaks — both keys stay server-side and neither
is prefixed `NEXT_PUBLIC_` — but anyone can call `/api/chat-stream` and spend the project's
quota without needing a key at all. Two layers of rate limiting cap it: **per IP per hour**
distributes fairly, **global per day** is the fuse that still holds if the first is bypassed
by rotating addresses.

Hitting a limit returns **a stream, not an error**. The frames are identical in shape to a
real model response, so a visitor arriving after the quota is gone still sees streaming
output, GFM rendering, syntax highlighting and the copy button — rather than a red error
box that reads as a broken demo.

GPT-4o mini is rejected server-side and greyed out in the picker, with the reason as a
permanent sub-label rather than a tooltip. It bills every token, where Gemini's free tier
fails closed at a 429.

---

## Tech Stack

| Layer               | Tech                                                       |
| ------------------- | ---------------------------------------------------------- |
| Framework           | Next.js 16 (App Router, React Compiler enabled)             |
| Language            | TypeScript 5                                                |
| AI Models           | Google Gemini (6 models), OpenAI GPT-4o mini                |
| Streaming           | Server-Sent Events (SSE)                                    |
| Auth                | NextAuth.js v4 (Google OAuth, database sessions)            |
| Database            | PostgreSQL + Prisma ORM                                     |
| Styling             | CSS custom properties + Tailwind 4 (no component library)   |
| Design system       | Fully tokenized Retro theme (single light theme)            |
| Markdown            | react-markdown + remark-gfm + react-syntax-highlighter      |
| Testing             | Jest + React Testing Library                                |
| Component Workshop  | Storybook 10 (Vite builder, a11y addon)                     |
| Containerization    | Docker (multi-stage, non-root) + Docker Compose             |
| CI/CD               | GitHub Actions (multi-arch build & push)                    |

---

## Architecture

### Streaming flow

```
User input → POST /api/chat-stream
           → Gemini or OpenAI streaming SDK
           → SSE chunks → TextDecoder → buffer parsing
           → 40ms throttled state updates → UI render
           → [DONE] + usage metadata → finalize message
           → POST /api/conversations/[id]/messages
```

All chat logic lives in one custom hook, [`useChat.ts`](src/app/hooks/useChat.ts) —
components stay presentational, and the streaming/cancellation/branching logic is unit
testable without mounting the app.

### Conversation branching

Editing a past message truncates every message after it and rebuilds the model context from
the edited point, so the next response is generated against the corrected history rather
than the original one.

---

## Getting Started

### Prerequisites

Node.js 20.9+ (Next.js 16 requirement; the Docker images use Node 22) · PostgreSQL ·
[Google AI Studio](https://aistudio.google.com) API key ·
OpenAI API key · Google OAuth credentials

### Install

```bash
git clone https://github.com/spencertyy/AI-ChatBot.git
cd AI-ChatBot
npm install
```

### Environment

Create `.env.local` in the project root:

```
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://your_connection_string
```

### Run

```bash
npm run dev          # http://localhost:3000
npm test             # unit tests
npm run storybook    # component workshop on :6006
```

---

## Run with Docker

The entire stack — app **and** PostgreSQL — runs with one command. No local Node or
Postgres install required.

```bash
cp .env.docker.example .env.docker   # then fill in your keys
docker compose up -d --build
```

| Service   | Image                 | Role                                                  |
| --------- | --------------------- | ----------------------------------------------------- |
| `db`      | `postgres:16-alpine`  | PostgreSQL; data persisted in the `pgdata` volume     |
| `migrate` | builder stage         | Runs `prisma migrate deploy` once, then exits         |
| `web`     | runner stage (~317MB) | Next.js standalone output, served on port 3000        |

Startup is gated by health checks — **db healthy → migrations applied → app starts**
(`service_completed_successfully`) — so the app never boots against an unmigrated database.

```bash
docker compose logs -f web   # tail app logs
docker compose down          # stop (keeps DB data)
docker compose down -v       # stop + wipe the database volume
```

### Prebuilt image

```bash
docker pull spencertu/ai-chat:1.0
```

Multi-stage build (deps → `prisma generate` + `next build` → minimal **non-root** runtime via
Next.js `output: "standalone"`) cuts the image from ~1 GB to ~317 MB. Secrets are injected at
runtime via `env_file`, never baked into a layer.

### Continuous deployment

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) builds a
**multi-arch (amd64 + arm64)** image with `docker buildx` on every push to `main` and pushes
it to Docker Hub, using Actions layer caching. Registry credentials are encrypted repository
secrets.

---

## Testing

**119 tests across 10 suites**, using **Jest** + **React Testing Library**, wired through
`next/jest`.

| Suite                      | Layer         | Tests | Covers                                                                                                                                        |
| -------------------------- | ------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `useChat.test.ts`          | Hook          |    44 | SSE parsing across split chunks, mid-stream cancellation, conversation branching, auto-titling, persistence for both guest and signed-in paths |
| `personaGuard.test.ts`     | Pure function |    18 | Draft parsing, banned-phrase & irreversible-advice enforcement, length warnings, retry-hint building                                           |
| `usage.test.ts`            | Pure function |    16 | Usage aggregation, null-heavy legacy rows, token/cost formatting                                                                               |
| `pricing.test.ts`          | Pure function |    10 | Cost calculation, unknown-model fallback                                                                                                       |
| `PersonaSelector.test.tsx` | Component     |     9 | Menu open/close, advisor/assistant grouping, keyboard & outside-click dismissal                                                                |
| `messages/route.test.ts`   | API route     |     6 | Ownership authorization, 404-not-403 on foreign ids, transactional write                                                                       |
| `sseStream.test.ts`        | Pure function |     6 | Buffer-then-replay framing, chunk cadence, `[DONE]` terminator                                                                                 |
| `InputArea.test.tsx`       | Component     |     4 | Typing, Enter-to-send, send button (module mock)                                                                                               |
| `localStorageChat.test.ts` | Data layer    |     3 | Save / load / delete + test isolation                                                                                                          |
| `ModelSelector.test.tsx`   | Component     |     3 | Render, menu open, model-select callback                                                                                                       |

Philosophy: test what can break — pure functions, the data layer, interactive components,
and hooks. Not presentation, config, or types.

---

## Component Workshop

Components are built and reviewed in isolation with **Storybook 10** (Vite builder via
`@storybook/nextjs-vite`), so each one can be developed without booting the app, logging in,
or touching the database. The `@storybook/addon-a11y` addon runs contrast and ARIA checks
against every story.

| Component          | Stories                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `CodeBlock`        | Per-language badges, unknown-language fallback, long-code overflow    |
| `MarkdownRenderer` | Rich GFM document, tables, fenced blocks routed into `CodeBlock`      |
| `InputArea`        | Idle / typing / loading states; callbacks mocked via `fn()` → Actions |
| `AuthButton`       | Signed-in vs signed-out, via a **mocked `SessionProvider`** decorator |

The Tailwind pipeline and design tokens load once in `.storybook/preview.tsx`, so components
render in Storybook exactly as they do in the app.

---

## Project Structure

```
.storybook/                              # Storybook config (main.ts, preview.tsx)
src/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts   # NextAuth handler
│   │   ├── chat-stream/route.ts          # SSE streaming endpoint (Gemini + OpenAI)
│   │   ├── usage/route.ts                # Aggregated token usage
│   │   └── conversations/
│   │       ├── route.ts                  # GET list, POST create
│   │       └── [id]/
│   │           ├── route.ts              # DELETE, PATCH title
│   │           └── messages/
│   │               ├── route.ts          # POST save messages
│   │               └── route.test.ts     #   └ test (authorization, transaction)
│   ├── components/
│   │   ├── Avatar.tsx                    # Persona avatar (image → emoji fallback)
│   │   ├── AuthButton.tsx                # Google login/logout
│   │   ├── CodeBlock.tsx                 # Syntax-highlighted code blocks
│   │   ├── DraftCard.tsx                 # Copyable "Reply" draft window
│   │   ├── InputArea.tsx                 # Composer (attach / image / send)
│   │   ├── MarkDownRenderer.tsx          # Markdown rendering
│   │   ├── MessageList.tsx               # Message list + action buttons
│   │   ├── ModelSelector.tsx             # Model dropdown (in advanced settings)
│   │   ├── PersonaSelector.tsx           # Persona picker (advisors + Straight Up)
│   │   ├── Providers.tsx                 # NextAuth SessionProvider wrapper
│   │   ├── Sidebar.tsx                   # Conversation list
│   │   ├── StreamingStats.tsx            # Live stream metrics
│   │   └── UsagePanel.tsx                # Token spend breakdown
│   ├── hooks/
│   │   ├── useChat.ts                    # All chat logic
│   │   └── useTheme.ts                   # Reads data-theme (locked light; used by CodeBlock)
│   ├── lib/
│   │   ├── demoResponse.ts               # Pre-recorded reply + SSE stream (demo fallback)
│   │   ├── localStorageChat.ts           # Signed-out history persistence
│   │   ├── personaGuard.ts               # Server-side validation of persona output
│   │   ├── personas.ts                   # Persona library + system-prompt builder
│   │   ├── pricing.ts                    # Per-model token cost
│   │   ├── rateLimit.ts                  # Per-IP + global quotas for the public demo
│   │   ├── sseStream.ts                  # Buffer-then-replay SSE helper
│   │   ├── themeColors.ts                # theme-color meta value
│   │   └── usage.ts                      # Usage aggregation & formatting
│   ├── types/chat.ts                     # Message, Conversation, Model, Persona types
│   ├── tokens.css                        # Design tokens (Retro)
│   ├── globals.css                       # Styles — consumes tokens only
│   ├── layout.tsx                        # Root layout (locked to the light Retro theme)
│   └── page.tsx
└── lib/
    ├── auth.ts                           # NextAuth config
    └── prisma.ts                         # Prisma client singleton
```

Tests (`*.test.ts(x)`) and stories (`*.stories.tsx`) are co-located with the code they cover.

---

## Roadmap

- RAG — attach documents and query over them
- Multimodal input — image and file upload via Gemini

---

## Credits

Persona avatars use the **"Dylan"** style by **Natalia Spivak**, via [DiceBear](https://www.dicebear.com/styles/dylan/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

---

## License

MIT
