import { Link, Route, Routes } from "react-router-dom";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import SchedulePage from "./pages/SchedulePage";
import SessionPage from "./pages/SessionPage";
import ReportPage from "./pages/ReportPage";
import AdminPage from "./pages/AdminPage";
import OfflineBanner from "./components/OfflineBanner";
import { useAppUser } from "./hooks/useAppUser";

const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SchedulePage />} />
      <Route path="/session/:sessionId" element={<SessionPage />} />
      <Route path="/session/:sessionId/report" element={<ReportPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
}

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

export default function App() {
  return (
    <div className="app-shell">
      <OfflineBanner />
      <header className="app-header">
        <span className="brand">InterviewAI</span>
        <span className="brand-sub">mock interview practice</span>
        {clerkConfigured && <HeaderAuthSlot />}
      </header>
      <main>
        {!clerkConfigured ? (
          <div className="voice-blocked">
            <p className="error">
              Sign-in isn't configured for this deployment (missing
              <code> VITE_CLERK_PUBLISHABLE_KEY</code>). Ask the administrator to set it up.
            </p>
          </div>
        ) : (
          <>
            <SignedOut>
              <div className="sign-in-prompt">
                <p>Sign in to schedule and run a mock interview.</p>
                <SignInButton mode="modal" />
              </div>
            </SignedOut>
            <SignedIn>
              <AppRoutes />
            </SignedIn>
          </>
        )}
      </main>
    </div>
  );
}
