import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import AuthBridge from "./auth/AuthBridge";
import "./styles.css";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const root = (
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
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
