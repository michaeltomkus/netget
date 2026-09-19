import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { sessionsRouter } from "./routes/sessions.js";
import { jobRolesRouter } from "./routes/jobRoles.js";
import { billingRouter } from "./routes/billing.js";
import { stripeWebhookRouter } from "./routes/stripeWebhook.js";
import { adminRouter } from "./routes/admin.js";
import { meRouter } from "./routes/me.js";
import { attachSttGateway } from "./gateway/sttGateway.js";
import { MEDIA_DIR } from "./services/media.js";
import { clerkAuth } from "./middleware/auth.js";
import { globalApiLimiter } from "./middleware/rateLimit.js";
import { attachExpressErrorHandler, initSentry, isSentryConfigured } from "./services/sentry.js";

initSentry();

const app = express();
const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: corsOrigin.split(",").map((o) => o.trim()) }));

// Mounted before express.json(): Stripe's webhook signature is computed
// over the exact raw request bytes, which JSON body-parsing would already
// have consumed — see routes/stripeWebhook.ts.
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookRouter);

// 8mb: the presentation-data endpoint accepts a batch of ~8 base64-encoded
// JPEG frames in one request (see routes/sessions.ts POST /:id/presentation).
app.use(express.json({ limit: "8mb" }));
// Verifies the Clerk session token (if any) on every request and attaches
// req.auth. Unlike every other provider integration in this app,
// clerkMiddleware() doesn't degrade gracefully on its own when unconfigured
// — it throws on every request once mounted (getAuth() requires it to have
// run) — so it's only mounted at all when a secret key is present; route-level
// requireAuth() then 503s cleanly instead. See middleware/auth.ts.
if (process.env.CLERK_SECRET_KEY) {
  app.use(clerkAuth);
}

// A coarse per-IP floor across every /api/* route; the two genuinely
// expensive routes (session creation, grading) get their own tighter,
// user-keyed limits on top of this — see routes/sessions.ts.
app.use("/api", globalApiLimiter);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasTts: Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
    hasStt: Boolean(process.env.DEEPGRAM_API_KEY),
    hasAuth: Boolean(process.env.CLERK_SECRET_KEY),
    hasBilling: Boolean(process.env.STRIPE_SECRET_KEY),
    hasErrorMonitoring: isSentryConfigured(),
  });
});

app.use("/api/sessions", sessionsRouter);
app.use("/api/job-roles", jobRolesRouter);
app.use("/api/billing", billingRouter);
app.use("/api/admin", adminRouter);
app.use("/api/me", meRouter);
app.use("/media", express.static(MEDIA_DIR));

// Mounted after every route: reports an error passed to next(err), or
// thrown synchronously in a non-async handler, to Sentry before Express's
// own default handler responds. Most routes already catch their own errors
// locally (logged + a clean error response sent) — this is the safety net
// for anything that isn't, plus routes/stripeWebhook.ts and the grading
// path additionally call captureException() directly on failures that are
// handled locally but still worth alerting on.
attachExpressErrorHandler(app);

const server = createServer(app);
attachSttGateway(server);

server.listen(port, () => {
  console.log(`InterviewAI mock-interview backend listening on :${port}`);
});
