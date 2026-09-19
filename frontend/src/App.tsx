import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import LandingPage from "./pages/LandingPage";
import SchedulePage from "./pages/SchedulePage";
import SessionPage from "./pages/SessionPage";
import ReportPage from "./pages/ReportPage";
import AdminPage from "./pages/AdminPage";
import OfflineBanner from "./components/OfflineBanner";
import { useAppUser } from "./hooks/useAppUser";

const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

// Only mounted when clerkConfigured, so useAppUser's useAuth() always has a
// ClerkProvider ancestor — see main.tsx.
function HeaderAuthSlot() {
  const { user } = useAppUser();
  return (
    <div className="auth-slot">
      <SignedIn>
        {user?.role === "admin" && (
          <Link to="/admin" className="admin-link">
            Admin
          </Link>
        )}
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </div>
  );
}

// The narrow, utilitarian shell for the actual app screens (schedule,
// session, report, admin) — distinct from LandingPage, which is full-width
// and renders its own header. Only used once a candidate is signed in.
function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <OfflineBanner />
      <header className="app-header">
        <span className="brand">InterviewAI</span>
        <span className="brand-sub">mock interview practice</span>
        <HeaderAuthSlot />
      </header>
      <main>{children}</main>
    </div>
  );
}

// A deep link (e.g. a bookmarked /session/:id) for someone who signed out —
// bounce to "/", which itself shows the landing page while signed out.
function RequireSignedIn({ children }: { children: ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <Navigate to="/" replace />
      </SignedOut>
    </>
  );
}

export default function App() {
  if (!clerkConfigured) {
    return (
      <div className="app-shell">
        <OfflineBanner />
        <header className="app-header">
          <span className="brand">InterviewAI</span>
          <span className="brand-sub">mock interview practice</span>
        </header>
        <main>
          <div className="voice-blocked">
            <p className="error">
              Sign-in isn't configured for this deployment (missing
              <code> VITE_CLERK_PUBLISHABLE_KEY</code>). Ask the administrator to set it up.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <>
            <SignedOut>
              <LandingPage />
            </SignedOut>
            <SignedIn>
              <AppShell>
                <SchedulePage />
              </AppShell>
            </SignedIn>
          </>
        }
      />
      <Route
        path="/session/:sessionId"
        element={
          <RequireSignedIn>
            <AppShell>
              <SessionPage />
            </AppShell>
          </RequireSignedIn>
        }
      />
      <Route
        path="/session/:sessionId/report"
        element={
          <RequireSignedIn>
            <AppShell>
              <ReportPage />
            </AppShell>
          </RequireSignedIn>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireSignedIn>
            <AppShell>
              <AdminPage />
            </AppShell>
          </RequireSignedIn>
        }
      />
    </Routes>
  );
}
