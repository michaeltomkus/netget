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

**Phase 3** (done): live in-session nudges while answering — pacing (too
fast/too slow), filler-word buildup, and long silences — shown as small,
low-opacity, non-blocking pills in the corner of the screen. Computed
entirely client-side from the live transcript stream, on a fixed 1s tick,
with zero LLM involvement and no effect on grading. Nudge text is always
drawn from a fixed lookup table keyed by a closed set of nudge kinds
(`pace_fast` / `pace_slow` / `filler_words` / `long_silence`) — delivery and
behavior only, by design, never answer content or suggested phrasing.

**Phase 4** (done): optional camera-based presentation feedback, gated
behind an explicit consent checkbox at schedule time. With consent, the
candidate gets a small self-preview and the app periodically (every ~15s)
samples a frame, computing on-device signals (lighting via a canvas
brightness read, plus a face-presence/gaze proxy via a client-side MediaPipe
face-landmark model — network-dependent and feature-detected, so it degrades
gracefully if it fails to load). At Finish, the sampled frames + signals are
sent once as a batch to Claude for attire/framing/eye-contact feedback,
added to the report card — then **the frames are deleted from disk
immediately after grading**; only the resulting scores/feedback text is
kept, never the raw images.

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

## What's next (Phase 5+)

Dynamic stress-test follow-ups (live interruptions/pushback via Claude
Haiku) and PWA installability — see `docs/ARCHITECTURE.md` §6 for the full
phase breakdown.
