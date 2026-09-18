# Mock Interview Practice App — Build Specification / Architecture Document

**Status:** Greenfield design doc, v1.
**Scope note:** Self-practice tool only. No feature here impersonates the candidate to any third party — all "interview" activity is simulated, AI-vs-candidate, for the candidate's own training benefit.

---

## 1. System Architecture / High-Level Data Flow

### 1.1 Component map

```
┌─────────────────────────────────────────────────────────────────────┐
│  Candidate Browser (PWA — Windows / Android / iOS-iPadOS Safari)     │
│                                                                       │
│  • Scheduling UI (role/seniority/company form)                       │
│  • Session UI: avatar renderer, captions, live-nudge overlay         │
│  • getUserMedia → local camera/mic capture + local self-preview      │
│  • MediaRecorder → full session recording (local buffer)             │
│  • Canvas frame sampler → periodic JPEG snapshots                    │
│  • WebSocket client → audio chunks up / TTS audio + events down      │
│  • Service worker (Workbox) → installability, asset caching          │
└───────────────┬───────────────────────────────────────┬─────────────┘
                │ HTTPS (REST)                          │ WSS (binary+JSON)
                ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend API (Node.js/TypeScript, containerized)                     │
│                                                                       │
│  • REST API: auth, scheduling, session CRUD, report retrieval        │
│  • Live Session Gateway (WebSocket): Interview Conductor state       │
│    machine, streams audio to/from STT/TTS, computes cheap live       │
│    nudges, emits avatar-state + caption + nudge events               │
│  • Question Generation Service (calls Claude, offline/async)         │
│  • Grading Pipeline (queue-driven, async, post-session)              │
│  • Pluggable provider interfaces: ISpeechToText, ITextToSpeech,      │
│    IVisionAnalyzer, IStorage, ILlm                                   │
└───┬──────────────┬───────────────┬───────────────┬──────────────┬───┘
    │              │               │               │              │
    ▼              ▼               ▼               ▼              ▼
 Azure AI      Azure AI Speech   Azure Blob     Anthropic API   Queue
 Speech STT    Neural TTS        Storage        (Claude)        (Azure
 (streaming)   (+ audio cache)   (recordings,   question gen,   Storage
                                  frames,        grading,        Queue /
                                  transcripts,   live-followup   Service
                                  reports)       generation      Bus)
```

### 1.2 End-to-end flow, narrated

1. **Schedule**: Candidate fills scheduling form (role, seniority, optional company/industry, stress-intensity slider). Backend calls Claude once to generate a tailored question set + per-question grading rubric snippets; TTS audio for every *fixed* question is pre-synthesized and cached in Blob Storage at this stage (not at call time) to eliminate TTS latency for the scripted portion of the interview.
2. **Join session**: Frontend opens a WebSocket to the Live Session Gateway. Backend's Interview Conductor (a per-session state machine) starts sending question events.
3. **Ask**: Backend sends `{type:"question", text, audioUrl}`; frontend plays cached audio, drives the avatar "speaking" indicator off the `<audio>` element's play/pause/timeupdate events, and renders captions in sync.
4. **Answer**: Candidate speaks. Mic audio (captured via `getUserMedia`) is chunked client-side (e.g., 20–100ms Opus/PCM frames via `AudioWorklet` or `MediaRecorder` timeslicing) and streamed up the WebSocket. Backend forwards the stream to Azure Speech's continuous recognition, gets interim + final transcripts with word timings.
5. **Live nudges**: Computed **backend-side, directly from interim STT output and simple counters** (see §5.3) — never routed through Claude — and pushed down the same WebSocket every few seconds as small JSON events the frontend renders as an unobtrusive corner overlay.
6. **Conductor decisions**: After each answer (or mid-answer, for interruption-style stress tactics), the Conductor either (a) advances to the next scripted question, or (b) — if the session's stress profile calls for it — invokes Claude with a short live prompt to generate a dynamic follow-up/pushback/interruption, sends that text through real-time TTS (not pre-cached, since it's generated live), and speaks it.
7. **Persist**: Each response (transcript, timing, audio segment ref, sampled frame refs) is written to the session record as it completes.
8. **End session**: Full local recording (if enabled) finalizes and uploads to Blob Storage (chunked upload during the session is preferable to one big upload at the end — see §7 risks). Backend enqueues a grading job.
9. **Grade (async)**: Worker pulls the job, runs content/structure grading per response via Claude, runs presentation-signal extraction from sampled frames + Claude synthesis, assembles the report card, stores it, and notifies the frontend (WebSocket push if still connected, otherwise polled on next visit).
10. **Review**: Candidate views the report card — per-question breakdown, overall scores, stress-question-specific performance section, and (if recording retained) can scrub back to specific moments.

### 1.3 A structural decision worth stating plainly

**This app does not need "real WebRTC" (an `RTCPeerConnection`, ICE/TURN, SFU, or Azure Communication Services).** The requirement "uses WebRTC for camera/mic capture" is satisfied by `getUserMedia` (formally part of the *Media Capture and Streams* spec, commonly bundled with "WebRTC" in casual usage) — that's just local media acquisition and a local self-preview `<video>` element. There is no second human peer to negotiate a P2P/SFU media path with; the "call" is a client-driven UI illusion (avatar + TTS + captions) layered over a plain client↔server channel. A normal WebSocket (or two: one for outbound audio frames, one for inbound TTS/events) does the whole job, is dramatically simpler to build/debug/host than any WebRTC signaling stack, and avoids NAT traversal/TURN costs entirely since it's ordinary client→your-server traffic. Keep `RTCPeerConnection` and ACS off the table unless a future version adds a real second human (e.g., a live human coach observing) or you specifically want WHIP/WHEP-style low-latency ingest — neither is in scope here.

---

## 2. Azure Service Choices (+ honest tradeoffs and cheaper alternatives)

Every one of these is a pluggable service behind a narrow interface (`ISpeechToText`, `ITextToSpeech`, `IVisionAnalyzer`, `IStorage`), selected by config/env var, specifically so components can be swapped later without an architecture rewrite.

### 2.1 Speech-to-Text (live transcription of candidate answers)
- **Azure choice**: Azure AI Speech — Speech-to-Text real-time/streaming recognition via the Speech SDK (WebSocket-based continuous recognition, interim + final results, word-level timestamps, punctuation).
- **Cost/complexity**: Pay-per-audio-second; real-time tier has per-region availability quirks; SDK is a native binary wrapped for Node (extra container image weight) or use the REST/WebSocket protocol directly to avoid the native dependency.
- **Cheaper/simpler alternative**: **Deepgram** (Nova-3) — typically lower per-minute pricing, very low latency, clean WebSocket streaming API with no native SDK dependency, generous free tier. **AssemblyAI** is a second viable alternative. Prototype against Deepgram first for developer velocity; keep Azure Speech as the "default enterprise" swap-in.

### 2.2 Text-to-Speech (interviewer voice)
- **Azure choice**: Azure AI Speech Neural TTS. SSML support lets you control prosody (pace, pitch, emphasis, pauses) — useful for making "stress interviewer" delivery feel curt/clipped vs. a warm baseline voice.
- **Cheaper/richer alternative**: **ElevenLabs** — more natural/expressive voices, higher cost per character, separate billing. Good upgrade path for V2 when the avatar becomes a talking-head video needing viseme/phoneme timing data. Use Azure Neural TTS for V1; revisit ElevenLabs for V2.

### 2.3 Video/image analysis for presentation grading (attire, framing, eye contact)
- **Caveat**: Azure **Face API** has been under Limited Access since 2022's Responsible AI changes — most non-trivial operations (head pose, landmarks) require an approval process. Don't assume same-day provisioning; avoid the dependency entirely (recommended below).
- **Recommended design**: split cheap signal extraction from judgment.
  - **Cheap signals** (live nudges + numeric grading input): client-side MediaPipe Face Landmarker (WebAssembly, in-browser) for head-pose/gaze-proxy and face-presence — video never leaves the device for this signal. Plus simple canvas-based lighting/contrast checks, also client-side.
  - **Judgment** (attire, background/framing, overall visual professionalism): sample ~6–10 representative frames per session, send as image content blocks directly to **Claude's multimodal input** alongside the numeric signals. No separate vision API needed.
  - **Azure AI Vision (Image Analysis 4.0)** — optional, not gated — for basic person/bounding-box detection if a second non-LLM opinion is wanted.
  - **Azure Video Indexer** — heavier, pricier, broadcast-oriented. Not recommended for V1/V2.
- **Privacy**: sending face imagery to any cloud attribute-detection API is sensitive (BIPA-style biometric laws, GDPR special-category data). The recommended design keeps raw landmark/gaze inference on-device and only sends ordinary JPEG frames (not biometric templates) to Claude. Document this in the privacy policy.

### 2.4 Storage of session recordings
- **Azure choice**: Azure Blob Storage. Hot tier for active/recent sessions, lifecycle policy to transition/delete per retention policy. Stores: recordings (if opted in), sampled frames, cached TTS audio, transcripts, report cards.
- **Cheaper alternative**: **Cloudflare R2** — S3-compatible, zero egress fees. Worth costing out once there's a rough sessions/month estimate, since recording playback egress is the likely biggest cost lever.

### 2.5 Hosting (frontend + backend API)
- **Azure choice**: **Azure Static Web Apps** for the PWA frontend (CDN, CI/CD, custom domain/TLS). **Azure Container Apps** for the backend API + WebSocket gateway (long-lived connections, KEDA autoscale, scale-to-zero). Azure App Service is a simpler alternative if fine-grained autoscaling isn't needed.
- **Cheaper alternative**: **Fly.io** or **Render** for the backend (often cheaper for small-scale long-lived-connection workloads). **Vercel/Netlify/Cloudflare Pages** for the frontend. Start on Azure for operational simplicity; revisit once real session-volume cost data exists — hosting is the easiest piece to swap.

### 2.6 Real-time media transport ("the call")
No ACS, no mediasoup, no self-hosted SFU (see §1.3). Plain WebSocket client↔server transport is correct for a 1:1 candidate-vs-AI-avatar session with no second human party. Revisit only if a future version adds a live human observer/coach.

---

## 3. Data Model (rough schema, not DDL)

```
User
  id, email, name, createdAt
  retentionPreference: { keepRecordings: bool, autoDeleteAfterDays: int }

Session                              # one "scheduled mock interview"
  id, userId, createdAt, scheduledFor?
  role: string
  seniority: enum(junior|mid|senior|staff|exec)
  companyContext?: string
  stressIntensity: enum(low|medium|high)
  status: enum(scheduled|in_progress|completed|graded|abandoned)
  questionSetId
  recordingConsent: bool
  recordingBlobRef?
  startedAt?, endedAt?

QuestionSet
  id, sessionId
  questions: [Question]

Question
  id, questionSetId, order
  type: enum(behavioral|technical|out_of_box|stress)
  text: string
  idealAnswerCriteria: string         # rubric, generated with the question
  expectedStructure?: enum(STAR|technical_walkthrough|open_ended)
  ttsAudioBlobRef
  followUpTriggers?: [string]

Response
  id, sessionId, questionId
  transcript: string
  transcriptSegments: [{text, startMs, endMs, isInterim: bool}]
  audioBlobRef?
  sampledFrameRefs: [string]
  liveNudgeSnapshots: [{atMs, wpm, fillerCount, silenceMs}]
  dynamicFollowUps: [{triggerType, text, respondedTranscript}]

GradingResult
  id, sessionId, generatedAt
  perQuestion: [{
    questionId,
    contentScore, contentFeedback,
    structureScore, structureFeedback,
    deliveryScore, deliveryFeedback,
  }]
  presentation: {
    attireScore, attireFeedback,
    framingLightingScore, framingLightingFeedback,
    eyeContactScore, eyeContactFeedback,
    sourceFrameRefs: [string]
  }
  composureUnderStress: {
    perStressQuestion: [{questionId, recoveryScore, feedback}],
    overallNarrative: string
  }
  overallScore, overallSummary, topStrengths: [string], topGrowthAreas: [string]
```

---

## 4. Grading Pipeline Design

### 4.1 Content-accuracy grading (Claude, async, per response)
For each `Response`: send Claude the `Question.text`, `Question.idealAnswerCriteria`, `Question.expectedStructure`, and the candidate's `transcript`. Request structured output so it deserializes directly into `GradingResult.perQuestion[i]`. Batch through the Message Batches API (async, no latency requirement, cost discount).

**Model**: Claude Sonnet 5 by default for per-response grading. Escalate to Claude Opus 5 only for the once-per-session `overallSummary`/`composureUnderStress.overallNarrative` synthesis.

**Prompt caching**: the grading system prompt (rubric methodology, STAR-check instructions, output schema) is identical across every call — cache it with a breakpoint before the per-question variable content. High-leverage given grading runs at volume.

### 4.2 Presentation grading (video/image → Claude synthesis)
Numeric signals (face-presence %, gaze/head-pose proxy from client-side MediaPipe, lighting histogram) plus ~6–10 representative JPEG frames go into a single Claude call (Sonnet 5) that returns attire, framing/background, and eye-contact scores + specific feedback.

### 4.3 Composure under stress-test questions
Grading distinguishes `Question.type == stress` responses: did structure/content quality degrade under interruption/pushback vs. baseline, how fast did the candidate recover, did they hold their position under challenge. Feed the `dynamicFollowUps` log into the Opus 5 synthesis call, not just the final transcript.

### 4.4 Live nudges — deliberately NOT going through Claude
Must be sub-second-to-few-second latency, never competing with an LLM call:
- **Pacing/WPM**: word count from STT interim results ÷ elapsed time, recomputed every ~3s.
- **Filler-word count**: simple keyword/regex match against the running transcript.
- **Silence detection**: gap since last STT word timestamp; past a threshold (~4–5s), surface a gentle nudge.
- **Eye-contact/engagement cue**: from the client-side MediaPipe signal — never leaves the browser for the live-nudge use case; only aggregated numeric summaries get logged to `liveNudgeSnapshots`.
- **UX constraint**: nudges render as a small, static-position, low-opacity corner badge — never a modal, never layout-shifting.

---

## 5. Question Generation Pipeline

### 5.1 From scheduling inputs to a question set
At schedule time, one Claude call with role, seniority, optional company/industry context, and stress-intensity. System prompt encodes the required taxonomy: (a) standard behavioral questions calibrated to seniority, (b) standard technical questions scoped to the role, (c) deliberately unconventional "out of the box" questions, (d) stress/pressure-test questions tagged with `followUpTriggers` (specific pushback angles the Conductor can draw on live). Structured output maps directly onto `QuestionSet`/`Question[]`, including `idealAnswerCriteria` generated alongside each question.

**Model**: Sonnet 5 — one call per scheduled session, cheap regardless.

**Prompt caching**: static system prompt (taxonomy rules, seniority calibration, output schema) is cacheable.

### 5.2 How "stress test" behavior gets triggered live, not just pre-scripted
The Interview Conductor state machine holds a `stressBudget` derived from `Session.stressIntensity`. When a stress-tagged answer completes (or, for interruption-style tactics, partway through — detected via STT interim results crossing a length/time threshold), the Conductor makes a short, low-latency Claude call: system prompt = "you are a tough interviewer; given this question, the candidate's answer so far, and this suggested pushback angle, generate a brief (1–2 sentence) challenging follow-up or interruption in character." Response goes straight to real-time TTS (not pre-cacheable) and is spoken.

**Model for this live path**: Claude Haiku 4.5 — fastest/cheapest current model, well suited to short tightly-scoped generation. Sonnet 5/Opus 5 stay on the offline, latency-insensitive paths.

**Three-tier model strategy**: Haiku 4.5 for live/latency-critical generation, Sonnet 5 for bulk async question-generation and per-response grading, Opus 5 for the once-per-session highest-value synthesis.

---

## 6. Phased Build Plan

**Phase 1 — Must-have. Text-only demo, no audio/video.**
Scheduling form (role/seniority/company) → Claude generates question set → candidate reads questions on screen and types answers → Claude grades content/structure only → basic report card. Proves the core scheduling → question-gen → grading loop end to end with zero media-pipeline risk.

**Phase 2 — Must-have. Voice in, voice out.**
TTS for questions (pre-cached), captions synced to audio, avatar static image + speaking indicator, `getUserMedia` mic capture, WebSocket streaming to STT, live transcript capture replacing typed answers. Grading gains delivery/tone feedback.

**Phase 3 — Must-have. Live nudges.**
Cheap, non-LLM live-nudge computations (WPM, filler words, silence detection) and the unobtrusive overlay UI. Nudges must not touch the grading/LLM path at all.

**Phase 4 — Must-have. Video capture + presentation grading.**
Local video capture/self-preview, client-side MediaPipe landmark signal extraction, periodic frame sampling/upload, full-session recording with explicit consent capture, presentation-grading Claude call added to the report card.

**Phase 5 — Must-have. Stress-test logic.**
Interview Conductor's dynamic stress-tactic triggering: interruptions, live pushback follow-ups via Haiku 4.5, `dynamicFollowUps` logging, composure-under-stress grading section. Sequenced after Phases 2–4 since it depends on working real-time audio and a working grading pipeline.

**Phase 6 — Nice-to-have / polish. PWA hardening. (Done, with caveats — see README.)**
Home-screen installability across Android and iOS/iPadOS Safari specifically, offline-friendly scheduling UI, session reminders where the platform allows, cross-browser WebRTC/media-permission edge-case handling. Shipped: manifest + service worker (app-shell precaching, verified via a real offline-reload test), iOS meta tags, offline banner, and a best-effort `getUserMedia`-failure hint for installed-iOS-PWA context. Deferred: session reminders (Web Push — a distinct integration). Unverified: actual iOS/iPadOS Safari behavior, since no iOS device or Safari engine was available to test against — real-hardware QA is still owed before relying on the iOS-specific mitigations.

**Phase 7 — Nice-to-have / future. V2 avatar upgrade.**
Swap the static-avatar renderer for a generated talking-head video behind the same `AvatarRenderer` abstraction established in Phase 2. Likely pairs with a TTS provider exposing viseme/phoneme timing (e.g., ElevenLabs). Out of scope for this build; noted so Phase 2's avatar interface is designed with this swap in mind.

**Phase 8 — Nice-to-have / future. Multi-provider hardening.**
Wire up and A/B the alternative providers named in §2 (Deepgram STT, ElevenLabs TTS, R2 storage) behind the existing interfaces, informed by real per-session cost data from Phases 1–5.

---

## 7. Open Questions / Risks to Resolve Before Later Phases

1. **Recording retention & consent.** Explicit, informed opt-in at schedule time (not buried in ToS), a clear default retention window with auto-delete, and a "delete my recordings" self-service control. Default recommendation: discard raw video after grading, keep only derived signals (transcript, scores, sampled frames) — the stronger privacy default.
2. **Cost per session estimate.** Needs a real number once Phase 2 is live and instrumented with real usage data from STT/TTS/Claude calls. Storage (full recordings or not) is the single biggest variable cost.
3. **Live-nudge latency vs. grading-call latency.** Fundamentally different latency budgets; keep fully decoupled in code review discipline, not just design intent.
4. **iOS/iPadOS Safari PWA limitations.** No Web Push until relatively recent iOS versions, more aggressive storage eviction for installed PWAs, `getUserMedia` permission behavior differs between installed-PWA and in-Safari-tab contexts, background audio/recording is more restricted. Test the full Phase 2 media pipeline on an installed, home-screen PWA on real iOS hardware before assuming Phase 6 is cosmetic-only — may need an "open in Safari tab" fallback for the live-session portion specifically.
5. **Azure Face API Limited Access gating.** If ever tempted to reach for Face API directly, budget real lead time for the approval process. The recommended design avoids this dependency entirely.
6. **STT/TTS provider swap validation.** Define an acceptance bar (latency, domain-specific-vocabulary transcript accuracy, subjective voice quality) before treating any provider swap as a drop-in — transcript accuracy feeds directly into content grading.
7. **Dynamic follow-up quality/consistency.** Haiku 4.5-generated live pushback needs eval coverage before Phase 5 ships broadly — a weak or tonally-off follow-up undermines the "convincing tough interviewer" illusion.
8. **Structured-output schema stability across Claude prompt-cache boundaries.** Schema changes invalidate prompt caches system-wide (schema is part of the cached prefix) — version the schema deliberately, batch changes.

---

### Critical files anchoring the implementation
- `backend/src/services/interfaces/ISpeechToText.ts`, `ITextToSpeech.ts`, `IVisionAnalyzer.ts`, `IStorage.ts` — pluggable-provider contracts
- `backend/src/gateway/interviewConductor.ts` — live-session state machine (question flow, stress-tactic triggering, nudge computation)
- `backend/src/services/questionGeneration.ts` — Claude question-gen call + structured-output schema
- `backend/src/services/grading/*.ts` — content, presentation, and composure grading Claude calls + prompt-caching setup
- `frontend/src/components/AvatarRenderer.tsx` — swappable avatar abstraction (static → video swap for V2)
