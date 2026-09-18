# InterviewAI — Mock Interview Practice

A self-practice mock interview tool. You schedule a simulated interview for a
target role/seniority, answer AI-generated questions (including out-of-the-box
and stress-test questions), and get graded feedback. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full build spec and
phased plan.

**Phase 1** (done): scheduling → question generation → typed answers →
content/structure grading → report card. (Typing was superseded by
voice-only answering — see the note after Phase 5.)

**Phase 2** (done): the interviewer now speaks each question (Azure Neural
TTS, pre-synthesized and cached per question) through a static avatar with a
speaking indicator, and the candidate answers by voice — mic audio streams
to the backend over WebSocket and gets transcribed live (Deepgram). Without
`AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` the session falls back to
captions-only (no voice). Only `ANTHROPIC_API_KEY` is required for the core
loop.

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

**Phase 5** (done): live stress-test interruptions. The STT WebSocket
gateway now acts as a lightweight Interview Conductor — for `stress`-type
questions, once the candidate's spoken answer crosses a length threshold, it
rolls against a per-session probability (derived from the session's stress
intensity) and, if triggered, calls Claude Haiku for a brief in-character
challenge, synthesizes it via TTS, and pushes it down the same socket as a
live interruption while the candidate's mic keeps recording underneath —
capped at one interruption per answer. The candidate sees/hears the pushback
and is expected to address it in their continuing answer. Interruptions are
logged and, if any fired during the session, a dedicated Claude call grades
composure under stress (did they hold their ground or fold) and adds it to
the report card. All of this degrades gracefully without
`ANTHROPIC_API_KEY`/`AZURE_SPEECH_*`/`DEEPGRAM_API_KEY` — same pattern as
every other provider integration so far.

**Answering is voice-only — deliberately, no text-input fallback.** The
transcript shown while answering is read-only (what the candidate said, not
an editable field), and there is no way to type a response instead of
speaking one. If `DEEPGRAM_API_KEY` isn't configured, or the mic/browser
isn't available, the question is hard-blocked with a clear message and a
retry button rather than silently falling back to typing — a candidate
without working voice input simply cannot answer, by design. (Phase 1's
original text-only flow no longer exists as a fallback; `DEEPGRAM_API_KEY`
is effectively required to complete a session, even though it's still
listed as "optional" in `.env.example` for local dev without voice.)

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

## What's next (Phase 6+)

PWA installability (home-screen install on Android/iOS, offline-friendly
scheduling, service worker caching) — see `docs/ARCHITECTURE.md` §6 for the
full phase breakdown.
