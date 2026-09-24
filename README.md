# Apple Chat

A beautiful, Apple-style AI chat app with buttery-smooth streaming — built with the [apple-ui-design](https://github.com/Tamoza4/apple-ui-design) system (8pt grid, SF Pro typography, glassmorphism, natural spring motion).

![stack](https://img.shields.io/badge/zero-dependencies-blue) ![node](https://img.shields.io/badge/node-%3E%3D16-brightgreen)

## Features

- 💬 **Real-time streaming** — SSE streamed with rAF-smoothed rendering and a blinking caret
- 🧵 **New chat / switch chats** — sidebar grouped by Today / Yesterday / Previous 7 Days / Older, **collapsible** (hamburger, ⌘/Ctrl+B, or the chevron inside the sidebar — state is remembered)
- 🗑️ **Delete chats** — with a macOS-style confirm dialog
- ✏️ **Rename chats** — click the title in the top bar
- 🔍 **Search chats**
- 🖼️ **Image generation** — free, keyless [Pollinations](https://pollinations.ai) (Flux model), no API key needed
- ⏳ **"Generating image…" while it renders** — the loading bubble (spinner + animated label) stays visible until the image's pixels actually arrive, then swaps to the finished picture — no blank gap
- 🎯 **Image mode stays out of the wrong chat** — the Image toggle is one-shot (auto-off after each generation) and resets when you switch chats, so an in-flight generation in one chat never turns another chat's next message into an image
- 🤖 **Model picker** — fetched live from the API's `/v1/models`
- 🧠 **Thinking toggle** — routes to a `-thinking` model variant and renders streamed reasoning in a collapsible panel
- 📋 **Rich formatting** — bold, italic, strikethrough, tables, task lists, nested lists, and **syntax-highlighted interactive code cards** (traffic lights, copy button, word-wrap toggle)
- 📋 **Copy messages**, ⬇️ **export chats as Markdown**
- ⏱️ **Response timing** — each reply shows how long it took to generate, right next to the Copy button
- ⌨️ **Keyboard shortcuts** — `⌘/Ctrl+K` new chat, `⌘/Ctrl+B` toggle sidebar, `⌘/Ctrl+F` search chats, `Enter` send, `Shift+Enter` newline, `↑` recall last message
- 🌗 **Light / Dark / Auto theme**, fully responsive (mobile sidebar + safe areas)
- 🔒 **100% local history** — every chat is saved in your browser's localStorage, never a database

## Quick start

```bash
npm start        # or: node server.js
```

## Deploy to Vercel

The repo ships with serverless functions in `api/` so it runs on Vercel with **zero changes** — push the repo, import it at [vercel.com/new](https://vercel.com/new), and deploy.

| Local (`node server.js`) | Vercel |
|---|---|
| static files + proxy in one process | static files from `public/`, proxy as functions in `api/` |
| same routes: `/api/chat`, `/api/models`, `/api/image` | identical — the frontend needs no changes |

Optional env var: `UPSTREAM` (defaults to `https://gemini-web2api-one.vercel.app`).

Open **http://localhost:3000** — no API key and no `npm install` needed.

> The small Node server only serves the UI and proxies `/v1/chat/completions` to `https://gemini-web2api-one.vercel.app` (the API doesn't send CORS headers, so the browser can't call it directly). Streaming is passed through untouched, chunk by chunk.
>
> Image generation returns a seeded Pollinations URL instantly; the browser then keeps the "Generating image…" bubble up until the image actually renders (Flux can take tens of seconds), falling back to an error card on failure or timeout.

## Configuration (optional)

| Env var | Default |
|---|---|
| `PORT` | `3000` |
| `UPSTREAM` | `https://gemini-web2api-one.vercel.app` |
| `IMAGE_API` | `https://image.pollinations.ai/prompt` |

## Models available

`gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-thinking`, `gemini-3.5-flash-thinking-lite`, `gemini-3.1-pro`, `gemini-3.1-pro-enhanced`, `gemini-auto`, `gemini-flash-lite`

The **Thinking** toggle maps your selected base model to its `-thinking` variant at request time, and shows any streamed `reasoning_content` in a collapsible "Thinking" panel above the composer.

## Project layout

```
├── server.js          # zero-dep Node server: static files + streaming proxy
└── public/
    ├── index.html     # app shell
    ├── styles.css     # Apple UI design system
    └── app.js         # chat state, localStorage store, streaming, UI logic
```
