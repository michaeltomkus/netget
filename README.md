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
sign-in — with one deliberate exception, `GET /api/billing/plans` (public,
so the landing page's pricing is real before anyone signs in). Without
`CLERK_SECRET_KEY` configured, the protected routes cleanly 503 ("Sign-in
is not configured") rather than the app crashing, same
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

**Public landing page**: `/` shows a full marketing page (`frontend/src/pages/LandingPage.tsx`)
to signed-out visitors — hero, problem/how-it-works, features, live Free/Pro/Premium
pricing, an FAQ, and a final CTA — with every call-to-action opening Clerk's sign-in
modal rather than a separate checkout flow; once signed in, a candidate lands on the
real Schedule page (which has its own billing UI to actually subscribe). A signed-in
visitor at `/` sees the Schedule page directly, and a signed-out deep link to
`/session/:id`, `/session/:id/report`, or `/admin` bounces to `/` rather than 404ing.

**Session history** (`/history`, linked from the header): every mock interview a
candidate has run, most recent first — role, seniority, date, status, and score once
graded — paginated (`GET /api/sessions`, 20 per page) rather than loaded all at once,
since a Pro/Premium candidate can accumulate an unbounded number of sessions over
time. A stat row up top shows total sessions, average score, and (once there are at
least two graded sessions) a small trend sparkline. Each row links to the report card
if graded, or back into the session to resume it if still in progress.

**Audio-reactive avatar**: `AvatarRenderer` now wires the actual question and
live-interruption `<audio>` elements into a Web Audio `AnalyserNode` and pulses a ring
around the avatar in real time with the genuine playback amplitude, instead of only
the fixed CSS glow from a boolean speaking/idle state. Driven by direct DOM writes to
a CSS custom property on every animation frame — not React state — so it doesn't
force a full re-render of the session page (which is also streaming a live transcript)
60 times a second. Degrades gracefully to the old static look wherever there's no real
audio to analyze (the landing page's hero mock) or the browser lacks Web Audio.

**Role catalog & a growing, sampled question bank**: the "target role" field on the
Schedule page is an autocomplete against a growing catalog (`JobRole`, `GET /api/job-roles`)
instead of a free-text box that spawned a bespoke question set every single time. Question
content itself is **never one static, replayable path** — see the correction below.

- **Existing role → instant.** Pick a suggestion and the session starts right away with a
  freshly *sampled* draw from that role's question bank — no Claude call on the scheduling
  path for an established role, just a DB query and copy.
- **New role → normalize, score, and gate it first** (`POST /api/job-roles/request`,
  `services/jobRoleClassifier.ts`). One Claude Haiku call standardizes the typed text into a
  canonical title and estimates a 0-100 "how common/interview-relevant is this" score —
  **a judgment call from Claude's own knowledge, not real labor-market data**; no such
  provider (BLS, Lightcast, a postings API, etc.) is integrated in this app, and the UI is
  worded accordingly. Score below the threshold (60) and the request is rejected outright
  with the rationale shown to the candidate — no retry limit, no admin queue.
- **Approved-but-new → schedule 5 minutes out.** The first-ever booking of a freshly
  approved role can't start instantly (its bank is empty): scheduling it sets
  `scheduledFor = now + 5min` and seeds an initial batch of questions in the background
  (fire-and-forget, in-process — no job queue in this app, so a mid-window server restart
  would require the next person to retrigger it). `SessionPage` shows a countdown
  (`ScheduledWaitRoom`) and polls `POST /:id/begin`, which 425s until both the clock and
  seeding are ready — in practice seeding finishes in seconds, so the wait is really just
  the 5 minutes.
- **A growing bank, not a fixed set — the actual point.** A role's questions live in
  `BankQuestion`, a pool that starts at 24 and keeps growing (in top-up batches, probabilistic
  above a "healthy" watermark, capped at 150 to bound Claude spend) toward hundreds of
  questions spread across Claude-assigned disciplines within the role. Each session draws its
  own composed, shuffled sample (`questionGeneration.ts` `assembleSessionQuestionSet` —
  targeting the same taxonomy every session always required: a behavioral/technical backbone,
  at least one out-of-the-box question, at least two stress questions), weighted toward the
  bank's least-used rows so a still-small bank rotates instead of always handing out the same
  top few. **This replaced an earlier, wrong version of this feature** that cached one fixed
  8-10 question set per role and replayed it verbatim, in the same order, to every candidate —
  exactly the "static, memorizable path" this design explicitly avoids. TTS audio is
  synthesized once per bank question and reused across every session that draws it, not
  re-synthesized per session. A session's own `stressIntensity` choice still shapes the *live*
  Interview Conductor's follow-up aggressiveness at runtime, independent of which questions
  were drawn. `companyContext` is still collected and shown for context but doesn't shape bank
  generation, since the bank is shared across candidates.

**Accounts & billing hardening**: closes several gaps from the initial billing pass.

- **Sign-in → checkout linking**: clicking "Start Pro/Premium" on the landing page
  now records the chosen plan (`utils/checkoutIntent.ts`, `sessionStorage`) before
  opening Clerk's sign-in modal; once signed in and landed on the real Schedule
  page, `BillingPanel` auto-resumes checkout for that plan instead of dropping the
  candidate on the free tier and making them find Subscribe again.
- **Account deletion & data export** (`/settings`, `GET`/`DELETE /api/me`): a
  GDPR-style "download my data" (every session, response, grading result, and
  subscription, as JSON) and "delete my account," which cancels any active Stripe
  subscription first (aborting rather than orphaning a live subscription if that
  fails), then deletes every local row, then — only once that's confirmed — the
  Clerk identity itself, in that order specifically so a failure partway through
  leaves the account intact and safely retryable rather than half-deleted.
- **Fair-use cap on "unlimited"**: Pro/Premium session creation was previously
  unbounded. `checkFreeTierLimit` now also gates active subscribers, at a
  generous 50 sessions/day — an abuse backstop, not a marketing change; no real
  candidate would ever come close. Distinct from, and layered under, the
  general per-IP rate limiter.
- **Optional free trial** (`STRIPE_TRIAL_PERIOD_DAYS`): applies `trial_period_days`
  to every new subscription's Checkout Session when set. Off by default.
- **Annual billing option** (`STRIPE_PRICE_ID_{PRO,PREMIUM}_ANNUAL`): a plan is
  offered at both intervals once both its Price ids are configured; `BillingPanel`
  shows a monthly/annual toggle only when at least one plan actually has an
  annual price. The landing page's pricing cards still only show monthly, to keep
  the public funnel simple — the toggle lives where someone's actually subscribing.

Deliberately **not** built in this pass, and why:
- **Referral program** — needs product decisions this repo can't make on its own
  (what the reward is, how a referral is attributed/verified) rather than a
  shallow, easily-abused version of one.
- **Admin actions on individual users** (manual comp/grant, cancel/refund from
  the dashboard) — an earlier, explicit scope decision limited the admin
  dashboard to metrics only ("use the Stripe dashboard directly for that," per
  `AdminPage.tsx`); building write-actions there would reverse that decision, so
  it wasn't done without confirming that's actually wanted.

**A/B testing infrastructure**: a lightweight, general-purpose way to test different copy,
layout, or a whole page against real end-user response — not a one-off, hard-coded experiment.

- **Experiments are code, not content.** Both `backend/src/services/experiments.ts` and its
  frontend mirror `frontend/src/experiments/experiments.ts` define a small registry — key,
  description, variant list. Adding an experiment is a code change and a deploy, never a
  migration; the two DB tables (`ExperimentExposure`, `ExperimentConversion`) only ever store
  raw events, validated against this registry.
- **Assignment is client-side and needs no round trip.** `useExperiment(key)`
  (`frontend/src/experiments/useExperiment.ts`) buckets the caller with a pure, deterministic
  hash of `experimentKey + subjectId` (equal-weighted across variants) — the same subject
  always lands in the same bucket, computed instantly on render, no backend call just to know
  which variant to show. Subject identity is the signed-in user's id once known, or a stable
  per-browser anonymous id before that (`localStorage`, see `experiments/subjectId.ts`) — a
  disclosed limitation of that: a signed-out exposure and a later signed-in conversion for the
  same physical person aren't automatically linked, since the id changes at sign-in.
- **One hook works for a whole page or one sub-component.** Call `useExperiment` once near
  the top of a page and branch its content on the result, or call it wherever one smaller
  component lives instead — same pattern either way. `LandingPage.tsx`'s hero section
  (`landing-hero-copy`) is a real, wired example: two full copy variants (headline, subhead,
  primary CTA text) for the same page, with `logConversion("hero_cta_click")` firing when the
  primary CTA is clicked.
- **Metrics captured server-side, read-only in the admin dashboard.** Exposure and conversion
  events post to `POST /api/experiments/{exposure,conversion}` — deliberately signed-out-
  reachable (an experiment can run before anyone's identified) and rate-limited instead of
  gated behind auth. Each table is unique per `(experiment[, goal], subject)`, so a page
  revisit or a repeat conversion never inflates the count — a plain row count already is
  "unique subjects." `/admin` now has an **A/B experiments** section (`GET
  /api/admin/experiments/:key/results`) showing exposures and conversion rate per variant —
  same read-only, metrics-only posture as the rest of that dashboard; nothing there can start,
  stop, or edit an experiment.

**Brand / design system**: `frontend/src/styles.css` now implements the "Aptera Call"
design tokens (dark palette, Space Grotesk/IBM Plex Sans/IBM Plex Mono type stack,
pill radius scale, no-gradient rule) supplied as a design handoff doc.

- **Scope taken**: the handoff spec describes a live video-call interview product
  (a Lobby screen, a Main call room with an AI notetaker, live transcript sidebar,
  and AI-suggested follow-up questions) — none of which exists in this app's actual
  architecture (audio-only interviews, no video call). Only the **token-level brand
  system** was applied — colors, type, radii, spacing, motion timing, the
  no-gradient rule — across this app's real screens (Landing, Schedule, Session,
  Report, History, Admin). The Lobby/call-room screens themselves weren't built;
  they're not this product. If a video-call feature is ever wanted, the spec is
  there to build from.
- **Dark-only, not dark/light**: the handoff is a single high-contrast dark theme,
  not a light+dark pair, so `styles.css` dropped its old
  `prefers-color-scheme: dark` override in favor of one dark theme for everyone
  (`color-scheme: dark`).
- **Placeholder tokens, disclosed by the source doc itself**: the handoff explicitly
  says no confirmed brand assets exist yet and its colors/fonts are mockup
  placeholders "swap...the moment they're supplied, without changing structure." All
  values live in `styles.css`'s `:root` block for that reason — updating real brand
  colors/fonts later is a token edit, not a structural one.
- **No gradients**: the brand's own rule. `--accent-gradient` is kept as a variable
  name (so the handful of call sites that reference it didn't need touching) but is
  now bound to a flat accent color, not a `linear-gradient(...)`.

**End-user communications**: an admin-facing way to compose and send templated,
multi-channel, A/B-variant messages to end users — a distinct, explicitly requested
capability from the rest of the admin dashboard's read-only metrics posture (see the
scope note in `routes/admin.ts`): this composes/sends messages, it still doesn't touch
any individual account or billing state.

- **Template library, seeded not invented.** `backend/src/services/communications/seedTemplates.data.json`
  holds 150 reference templates — 25 lifecycle events (Welcome, Email Verification,
  Payment Failed, ...) across 7 categories x 3 channels (email/sms/push) x 2 A/B copy
  variants — derived from a supplied lifecycle-communications reference set. `POST
  /api/admin/communications/templates/seed` upserts them by a stable `key`, so it's
  idempotent and safe to re-run. An admin composes from this library; nothing here
  generates new copy on its own.
- **`{variable}` templating.** `services/communications/template.ts` extracts and
  renders `{first_name}`-style tokens; an unresolved token is left visible in the
  rendered output rather than silently blanked, so a typo'd merge field is obvious
  in the send history instead of shipping a blank.
- **A/B split is deterministic, not per-send-random.** When a lifecycle event has two
  variants for a channel, `services/communications/send.ts` buckets each recipient
  with the same FNV-1a-hash approach as the page-level A/B infrastructure above
  (`experiments/assignVariant.ts`) — re-running a send against the same audience
  reproduces the same split rather than reshuffling who got which copy.
- **Provider-agnostic, graceful-degradation delivery.** Each channel is one plain
  HTTPS POST to a `{CHANNEL}_PROVIDER_WEBHOOK_URL` (see `.env.example`) — no vendor
  SDK, same "avoid SDK weight" choice already made for Azure TTS. Without a URL
  configured, a send still renders and logs every recipient's message as
  `skipped_no_provider` rather than failing — the whole feature is usable and
  testable (composer, audience targeting, A/B split, history) with zero messaging
  infrastructure wired up.
- **Full send audit log, not fire-and-forget.** Every attempt — `sent`,
  `skipped_no_provider`, or `failed` (with its error) — is written to
  `CommunicationSend`, shown in the admin composer's history table and queryable per
  (lifecycle event, channel) for a sent-count-per-variant tally.
- **Audience targeting** is intentionally small to start: all users, active
  subscribers only, or a single user by email — not a full segmentation builder.

**Operational hardening**: rate limiting (`express-rate-limit`), a real automated test
suite, CI, and error monitoring — the highest-priority engineering/ops gaps once this
stopped being a toy.

- **Rate limiting**: a coarse per-IP floor (300 req/15min) across every `/api/*`
  route, plus tighter user-keyed limits on the two genuinely expensive actions —
  session creation (10/15min) and grading (20/15min) — since each spends real
  Anthropic (and, for creation, Azure/Deepgram) cost. Keyed by the authenticated
  user rather than IP where possible, so a leaked token can't dodge the limit by
  hitting the API from a different address than its owner.
- **Automated tests** (Vitest, both workspaces — `npm run test` in either): backend
  unit tests for the Stripe plan registry and free-tier gating logic, plus
  supertest-driven integration tests for session validation, ownership (404-not-403),
  and the rate limiter itself, all with Prisma/Clerk/Anthropic/Stripe mocked out —
  nothing hits a real database, network, or API key. Frontend tests cover
  `formatPlanPrice`, `useOnlineStatus`, and `AvatarRenderer`'s graceful fallback when
  Web Audio isn't available. This is a starting suite, not full coverage — most UI
  flows are still only verified manually.
- **CI** (`.github/workflows/ci.yml`): typecheck, test, and build for both workspaces
  on every push and PR. No lint step (no ESLint config exists in this repo).
- **Error monitoring** (Sentry, optional — `SENTRY_DSN`/`VITE_SENTRY_DSN`): backend
  captures uncaught exceptions/rejections automatically once initialized, plus an
  Express error-handling middleware and explicit `captureException()` calls on the
  Stripe webhook and grading failure paths — the two "fails silently in production"
  risks named as the reason to add this at all. Frontend wraps the whole app in a
  `Sentry.ErrorBoundary` with a friendly fallback UI, which works as a plain React
  error boundary (no blank white screen on a render crash) even without a DSN
  configured. Without either DSN, everything no-ops — same graceful-degradation
  pattern as every other provider integration in this app.

Two disclosed trade-offs from this pass: `vitest@2.1.9` (pinned for the frontend,
since `vitest@5`'s `vite` peer requirement conflicts with this project's `vite@^5.4`)
carries a critical advisory in its `--ui` dev-server mode — this project's test
script only ever runs `vitest run` (used in CI too), never `--ui`, so that surface is
never exposed; and Sentry's full request-tracing needs Node's `--import` instrumentation
flag, which this project's plain `tsc`/`tsx` scripts don't set up — error capture
(the actual ask) works fully without it, so that rework was skipped for now.

**Environment tiers & release escalation** (`.github/workflows/deploy.yml`,
`docs/ENVIRONMENTS.md`): development -> uat -> preprod -> production, as one
pipeline that reuses the CI workflow for its build-and-test step. Development
and UAT deploy automatically once tests pass; preprod and production each sit
behind a GitHub Environment "required reviewers" gate, so escalating past UAT
needs an explicit human approval and can't be skipped (`deploy-production`
depends on an approved `deploy-preprod`, which depends on a successful
`deploy-uat`). Each tier gets its own env-var reference at
`deploy/environments/<tier>.env.example` — separate databases and Stripe keys
per tier (test-mode through preprod, live only in production) is what
actually keeps a UAT walkthrough from touching real data or charging a real
card. The two things that can't be set up from here: the actual "required
reviewers" list on the preprod/production Environments is a one-time,
repo-admin action in GitHub's Settings UI (exact steps in
`docs/ENVIRONMENTS.md`), and `scripts/deploy.sh` is a labeled placeholder —
no hosting provider is chosen yet, so there's nothing real for it to deploy
to. The pipeline's shape (gate structure, approval requirement, tier
separation) is real and usable today regardless.

## Setup

Requires Node >=22 (see root `package.json`'s `engines` field) — `jsdom@30`
and `vitest@5` in the test suites declare that as a hard runtime
requirement, not just a lint warning; CI runs on Node 22 for the same
reason.

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
            ENVIRONMENTS.md — environment tiers and the release approval path.
deploy/     environments/<tier>.env.example — per-tier env var reference
            (development/uat/preprod/production).
scripts/    deploy.sh — per-tier deploy hook, invoked by deploy.yml (currently
            a placeholder — see docs/ENVIRONMENTS.md).
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
- **Full talking-head video avatar** — `AvatarRenderer` is now audio-reactive
  (see below) rather than fully static, but the interviewer is still a still
  image, not generated video. That's a materially bigger lift (a paid
  third-party video-generation provider, per-question generation latency/cost
  on top of Claude/TTS/STT) deliberately not taken on without a provider
  choice from the person running this.
