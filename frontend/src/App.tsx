import { Route, Routes } from "react-router-dom";
import SchedulePage from "./pages/SchedulePage";
import SessionPage from "./pages/SessionPage";
import ReportPage from "./pages/ReportPage";
import OfflineBanner from "./components/OfflineBanner";

export default function App() {
  return (
    <div className="app-shell">
      <OfflineBanner />
      <header className="app-header">
        <span className="brand">InterviewAI</span>
        <span className="brand-sub">mock interview practice</span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SchedulePage />} />
          <Route path="/session/:sessionId" element={<SessionPage />} />
          <Route path="/session/:sessionId/report" element={<ReportPage />} />
        </Routes>
      </main>
    </div>
  );
}
