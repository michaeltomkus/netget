import * as Sentry from "@sentry/react";

// Same graceful-degradation pattern as every other provider integration in
// this app: without a DSN, this is a no-op and nothing else about the app
// changes.
export function isSentryConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SENTRY_DSN);
}

/** Call once, before the app renders — see main.tsx. */
export function initSentry(): void {
  if (!isSentryConfigured()) return;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN as string,
    environment: import.meta.env.MODE,
    // A render-time crash is rare enough here that full session/trace
    // volume isn't worth paying for on a project with no real SLA yet.
    tracesSampleRate: 0.1,
  });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
