import * as Sentry from "@sentry/node";
import type { Express } from "express";

// Same graceful-degradation pattern as every other provider integration in
// this app: without SENTRY_DSN, every function here is a no-op and nothing
// else about the app changes.
export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

/**
 * Call once, at startup, before the Express app is built. Error capture
 * (captureException, uncaught exceptions/rejections, and the Express error
 * handler below) all work from this alone. Full request tracing does not —
 * the SDK logs "express is not instrumented" because OpenTelemetry-based
 * auto-instrumentation needs Sentry loaded via `node --import` before the
 * app's other modules, not a plain init() call from inside one of them.
 * Not worth the dev/build/start script rework for a low sample rate kept
 * on a project with no real SLA yet; revisit if tracing volume matters
 * later.
 */
export function initSentry(): void {
  if (!isSentryConfigured()) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}

/** Mount after every route (and before server.listen) so uncaught route errors are reported. */
export function attachExpressErrorHandler(app: Express): void {
  if (!isSentryConfigured()) return;
  Sentry.setupExpressErrorHandler(app);
}

/**
 * For an error path that's already handled locally (logged, and a response
 * already sent) but is still worth alerting on in production — a grading
 * pipeline failure or a Stripe webhook that couldn't be processed, not a
 * routine 400 for a bad request body.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!isSentryConfigured()) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
