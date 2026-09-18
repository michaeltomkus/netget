# InterviewAI — Mock Interview Practice

A self-practice mock interview tool. You schedule a simulated interview for a
target role/seniority, answer AI-generated questions (including out-of-the-box
and stress-test questions), and get graded feedback. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full build spec and
phased plan — this is **Phase 1**: scheduling → question generation → typed
answers → content/structure grading → report card, with no audio/video yet.

## Setup

```bash
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY
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

## What's next (Phase 2+)

Voice in/out, live avatar with a speaking indicator, live in-session nudges
(pacing, filler words), video capture + presentation grading, dynamic
stress-test follow-ups, and PWA installability — see
`docs/ARCHITECTURE.md` §6 for the full phase breakdown.
