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
to the backend over WebSocket and gets transcribed live (Deepgram). At the
time this shipped, missing `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` fell
back to captions-only — **that fallback no longer exists** now that
questions are audio-only (see the note further down): without a working
Azure Speech key, every question hard-blocks. `AZURE_SPEECH_KEY` and
`DEEPGRAM_API_KEY` are both effectively required in practice, alongside
`ANTHROPIC_API_KEY`.

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

**Phase 6** (done): PWA installability. A web app manifest + Workbox
service worker (via `vite-plugin-pwa`) precache the app shell (JS/CSS/HTML/
icons) so the app installs to the home screen on Android and iOS/iPadOS and
loads instantly even offline — verified with a real headless-browser test:
full page reload with the network cut works and renders correctly from
cache. Deliberately **not** cached: anything under `/api` or the `/ws`
socket — session data, grading, and live voice always hit the network live,
never served stale. An offline banner (via the `online`/`offline` browser
events) tells the candidate plainly that scheduling/voice/grading still need
a connection even though the shell loaded. iOS gets its own meta tags
(`apple-mobile-web-app-*`, `apple-touch-icon`) since Safari doesn't read the
manifest for those. `getUserMedia` failures now carry an extra hint when the
app is detected running as an installed iOS PWA, suggesting opening the page
in Safari directly — this is a best-effort mitigation for the risk flagged
in `docs/ARCHITECTURE.md` §7 risk #4, **not a verified fix**: there's no
real iOS device or Safari engine available in this build environment, so
actual iOS home-screen behavior (including whether mic/camera access works
at all when installed) still needs testing on real hardware before you rely
on it. Session reminders via Web Push were **deliberately left out** of this
phase — that's a distinct integration (VAPID keys, push subscription
storage, a backend send endpoint, materially different iOS 16.4+-only
support) substantial enough to warrant its own pass rather than folding
silently into "PWA polish."

**Audio-only questions** (post-Phase-6): questions are never shown as text
on screen — like a real interview, the candidate only hears them, spoken by
the interviewer avatar. A screen-reader-only element carries the question
text for accessibility (present in the accessibility tree, not visually
readable), and a persistent "Replay question" button lets the candidate
re-hear it at will. If a specific question's audio wasn't synthesized (TTS
not configured, or a transient per-question failure), that question is
hard-blocked with a clear message and no text fallback — consistent with
the voice-only-answering hard block above, there's no silent "just show the
text" escape hatch.

**Time-aware grading**: scheduling now includes a target length (15/30/45/60
minutes). The report card compares actual session duration (session creation
to Finish) against that target and includes a qualitative assessment — not a
bare "ran over = bad" penalty. Good interviews often run long because
thorough answers take longer; the grading prompt is explicitly steered to
judge whether the extra (or saved) time correlated with answer depth, not to
score the raw time delta by itself.

**Accounts, database, and billing** (post-Phase-6): sessions, questions,
responses, grading results, users, and subscriptions now live in Postgres
via Prisma (`backend/prisma/schema.prisma`), replacing the flat JSON file
used through Phase 6. Sign-in is federated through
[Clerk](https://clerk.com) (Google and whatever other providers are enabled
in the Clerk dashboard) — this app never sees or stores a password. Every
`/api/sessions`, `/api/billing`, `/api/admin`, and `/api/me` route requires
sign-in; without `CLERK_SECRET_KEY` configured, those routes cleanly 503
("Sign-in is not configured") rather than the app crashing, same
graceful-degradation pattern as the voice providers. Subscription billing is
handled entirely by [Stripe](https://stripe.com) Checkout and the Customer
Portal (both hosted pages) — this app never sees or stores card data, only
the resulting subscription id/status/price from Stripe webhooks. There's a
free tier (3 sessions/calendar month by default, see
`FREE_TIER_SESSIONS_PER_MONTH` in `backend/src/routes/billing.ts`), with an
in-app nudge that escalates as the limit approaches (1 left, then 0 left)
rather than only messaging once the candidate is actually blocked. An
admin dashboard at `/admin` (role granted via the `ADMIN_EMAILS` allowlist
at first sign-in) shows revenue/usage metrics (MRR, active subscriber
count and a per-plan breakdown, session volume) — deliberately
metrics-only, with no manual comp/grant or cancel/refund actions, per the
scope this was built to.

**Two paid tiers** (post-launch): **Pro** (unlimited sessions) and
**Premium** (unlimited sessions plus a personalized AI-generated practice
plan attached to every report card — 3-5 concrete next steps tied to what
actually happened in that session, and a recommendation for what to
schedule next). Plan display metadata (name/tagline) lives in
`backend/src/services/stripe.ts`; the price itself always comes live from
Stripe via `GET /api/billing/plans`, so changing an amount in the Stripe
dashboard needs no deploy. An already-subscribed candidate switches plans
through the Customer Portal ("Manage billing"), never through a second
Checkout session — creating one while already subscribed would double-bill
them, so `POST /api/billing/checkout` refuses with 409 if the caller
already has an active subscription.

## Setup

```bash
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY (required),
                        # AZURE_SPEECH_*/DEEPGRAM_API_KEY (optional, for voice),
                        # DATABASE_URL (required — a running Postgres instance),
                        # CLERK_SECRET_KEY/VITE_CLERK_PUBLISHABLE_KEY (required for sign-in),
                        # and STRIPE_* (optional, for billing)
cd backend && npx prisma migrate deploy   # applies the schema to DATABASE_URL
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
            Storage is Postgres via Prisma (backend/prisma/schema.prisma).
            Auth is Clerk (backend/src/middleware/auth.ts), billing is
            Stripe (backend/src/routes/billing.ts + stripeWebhook.ts).
frontend/   React/TypeScript/Vite PWA. Schedule a session, answer questions
            one at a time, view the report card, manage billing, and (for
            admins) view revenue/usage metrics at /admin.
docs/       ARCHITECTURE.md — the full system design and phased build plan.
```

## What's next

All must-have phases (1-5) plus Phase 6 (PWA polish) from
`docs/ARCHITECTURE.md` §6 are done. Remaining, lower-priority items:

- **Real iOS device QA** — the biggest open risk. Verify home-screen install,
  `getUserMedia` (mic/camera) behavior in the installed standalone context,
  and general layout/interaction on actual iOS/iPadOS Safari.
- **Session reminders via Web Push** — deliberately deferred from Phase 6 (see
  above).
- **Phase 8 (multi-provider hardening)** — wire up and A/B the cheaper
  alternative providers named in the architecture doc (Deepgram is already
  the default; Cloudflare R2 for storage, etc.) once there's real per-session
  cost data.
- **V2 avatar upgrade (Phase 7)** — swap the static image in
  `AvatarRenderer` for a generated talking-head video; the component's
  `state` prop was designed for this swap from the start.
