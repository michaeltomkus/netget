import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import AuthBridge from "./auth/AuthBridge";
import { initSentry, SentryErrorBoundary } from "./services/sentry";
import { getBrandVariant } from "./config/brand";
import "./styles.css";

initSentry();

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const brand = getBrandVariant();

function ErrorFallback() {
  return (
    <div className="app-shell">
      <div className="voice-blocked">
        <p className="error">Something went wrong loading {brand.name}.</p>
        <p className="muted">Try reloading the page. If it keeps happening, let us know.</p>
        <button type="button" className="secondary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

const root = (
  <React.StrictMode>
    <SentryErrorBoundary fallback={<ErrorFallback />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SentryErrorBoundary>
  </React.StrictMode>
);

// Same graceful-degradation pattern as every other provider integration in
// this app: without a publishable key, render unauthenticated (App.tsx's
// SignedOut gate then explains sign-in isn't configured) rather than
// crashing the whole app on a missing env var.
ReactDOM.createRoot(document.getElementById("root")!).render(
  clerkPublishableKey ? (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <AuthBridge />
      {root}
    </ClerkProvider>
  ) : (
    root
  ),
);
