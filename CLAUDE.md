# AnimeUta Project Context

## Product

AnimeUta is a private ACG Japanese-learning music app for an owner and a few invited friends. The core loop is local song import, synchronized bilingual lyrics, Japanese vocabulary extraction, and spaced-repetition study.

## Fixed architecture

- Frontend: React, TypeScript, Vite, Zustand, TanStack Query, i18next, Tailwind CSS.
- Mobile: installable PWA plus Capacitor Android/iOS projects. Tauri may be added later for desktop.
- Backend: one TypeScript Fastify process.
- Database: SQLite in WAL mode. SQL migrations live in `backend/src/migrations`.
- Jobs: a persistent in-process worker backed by the SQLite `lyric_processing_job` table.
- Media: private local storage by default; remote object storage is an optional later adapter.
- AI: OpenAI-compatible text and transcription endpoints, configurable for Ollama or hosted providers.

Do not reintroduce Go, PostgreSQL, Redis, Kafka, microservices, scraping, private music APIs, seckill, GEO, danmaku, or heavy social features without a new explicit decision.

## Product rules

- The first account is the owner. Later registrations are invite-only by default.
- Friend imports are private. A user explicitly requests sharing before an item enters review.
- Audio is supplied by the user; AnimeUta does not fetch protected music sources.
- The UI must support Chinese, Japanese, and English user-facing text.
- Internal values such as `local_upload` must never be shown directly.
- Audio routes use expiring signatures and byte ranges; the PWA must not cache audio.

## Commands

```powershell
cd backend
npm install
npm run migrate
npm run dev

cd ../frontend
npm install
npm run dev
```

Verification: `npm run check`, `npm test`, and `npm run build` in `backend`; `npm run build` and `npm run mobile:sync` in `frontend`.
