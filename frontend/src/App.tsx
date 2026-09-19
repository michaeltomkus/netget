import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import LandingPage from "./pages/LandingPage";
import SchedulePage from "./pages/SchedulePage";
import SessionPage from "./pages/SessionPage";
import ReportPage from "./pages/ReportPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import AdminPage from "./pages/AdminPage";
import OfflineBanner from "./components/OfflineBanner";
import { useAppUser } from "./hooks/useAppUser";
import { useBrand } from "./hooks/useBrand";
import { getBrandVariant } from "./config/brand";

const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
// Only for the !clerkConfigured fallback below, which renders outside
// ClerkProvider entirely (main.tsx doesn't mount it without a publishable
// key) — useBrand() can't be called there since it needs useAuth() via
// useExperiment/useAppUser. Every other brand-name render in this app goes
// through useBrand() instead, which is experiment/override-aware.
const fallbackBrand = getBrandVariant();

// Only mounted when clerkConfigured, so useAppUser's useAuth() always has a
// ClerkProvider ancestor — see main.tsx.
function HeaderAuthSlot() {
  const { user } = useAppUser();
  return (
    <div className="auth-slot">
      <SignedIn>
        <Link to="/history" className="admin-link">
          History
        </Link>
        <Link to="/settings" className="admin-link">
          Settings
        </Link>
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
  const brand = useBrand();
  return (
    <div className="app-shell">
      <OfflineBanner />
      <header className="app-header">
        <span className="brand">{brand.name}</span>
        <span className="brand-sub">{brand.tagline}</span>
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
          <span className="brand">{fallbackBrand.name}</span>
          <span className="brand-sub">{fallbackBrand.tagline}</span>
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
        path="/history"
        element={
          <RequireSignedIn>
            <AppShell>
              <HistoryPage />
            </AppShell>
          </RequireSignedIn>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireSignedIn>
            <AppShell>
              <SettingsPage />
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
