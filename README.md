# InterviewAI — Mock Interview Practice

A self-practice mock interview tool. You schedule a simulated interview for a
target role/seniority, answer AI-generated questions (including out-of-the-box
and stress-test questions), and get graded feedback. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full build spec and
phased plan.

**Phase 1** (done): scheduling → question generation → typed answers →
content/structure grading → report card.

**Phase 2** (done): the interviewer now speaks each question (Azure Neural
TTS, pre-synthesized and cached per question) through a static avatar with a
speaking indicator, and the candidate answers by voice — mic audio streams
to the backend over WebSocket, gets transcribed live (Deepgram), and shows up
as an editable running transcript. Both providers are optional: without
`AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` the session falls back to
captions-only (no voice); without `DEEPGRAM_API_KEY` the candidate just
types. Only `ANTHROPIC_API_KEY` is required for the core loop.

## Setup

```bash
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY (required),
                        # and AZURE_SPEECH_*/DEEPGRAM_API_KEY (optional, for voice)
```

## Run (two terminals)

```bash
npm run dev:backend   # http://localhost:4000
npm run dev:frontend  # http://localhost:5173
```

Open http://localhost:5173, schedule a session, answer the questions, and
view the report card.

## Project layout

```
backend/    Node/TypeScript/Express API. Question generation and grading
            both go through Claude via tool-use for structured output.
            Storage is a flat JSON file (backend/data/db.json) for now —
            see docs/ARCHITECTURE.md §2.4 for the intended swap to a real
            store later.
frontend/   React/TypeScript/Vite PWA-to-be. Three pages: schedule a
            session, answer questions one at a time, view the report card.
docs/       ARCHITECTURE.md — the full system design and phased build plan.
```

## What's next (Phase 3+)

Live in-session nudges (pacing, filler words, silence — delivery/behavior
only, never answer content), video capture + presentation grading, dynamic
stress-test follow-ups, and PWA installability — see
`docs/ARCHITECTURE.md` §6 for the full phase breakdown.
