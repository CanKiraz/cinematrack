# CinemaTrack 🎬

Your personal movie watchlist and statistics tracker — a local Windows desktop app with AI-powered discovery.

## Features

- **Watchlist** — Search TMDB, add movies, filter by genre, mark as watched with optional rating & notes
- **Statistics** — GitHub-style heatmap calendar, total counts, average rating, favorite genre, full watch history
- **AI Chat** — Chat with Gemini to find movies, pick from your watchlist, or ask about your watching habits

## Prerequisites

1. **Node.js v18+** — Download from [nodejs.org](https://nodejs.org) (LTS recommended)
2. **TMDB API key** (free) — Register at [themoviedb.org](https://www.themoviedb.org/signup), go to Settings → API → Request API Key
3. **Gemini API key** (free) — Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → Create API Key

## Setup

```bash
# 1. Install dependencies (also rebuilds better-sqlite3 for Electron)
npm install

# 2. Start the app in development mode
npm run dev
```

On first launch, a settings dialog will appear. Paste in your TMDB and Gemini API keys.

## Package as a Windows installer

```bash
npm run package
```

This outputs an `.exe` installer in `dist/`.

## Project structure

```
src/
  main/           Electron main process (Node.js)
    index.ts      App entry, BrowserWindow
    database.ts   SQLite — all DB operations
    ipc.ts        IPC handlers + Gemini AI + TMDB API calls
  preload/
    index.ts      contextBridge — safely exposes API to renderer
  renderer/
    index.html    HTML entry point
    src/
      pages/      Watchlist · Stats · AIChat
      components/ Sidebar · MovieCard · HeatmapCalendar · SettingsModal
      types/      Shared TypeScript types + Window declaration
```

## Data storage

Your database is stored at:
- **Windows**: `%APPDATA%\cinematrack\cinematrack.db`

Nothing leaves your machine except TMDB and Gemini API calls.

## Tech stack

| Thing | What | Cost |
|---|---|---|
| Electron + React | Desktop shell + UI | Free |
| better-sqlite3 | Local database | Free |
| TMDB API | Movie data, posters | Free |
| Google Gemini 1.5 Flash | AI chat | Free (1M tokens/day) |
| Tailwind CSS | Styling | Free |
