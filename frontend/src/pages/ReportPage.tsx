import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getBillingStatus, getReport, startCheckout } from "../api/client";
import type { CandidateQuestion, GradingResult, ResponseRecord, Session } from "../api/types";

interface ReportData {
  session: Session;
  questions: CandidateQuestion[];
  responses: ResponseRecord[];
  result: GradingResult;
}

export default function ReportPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Whether the candidate is already Premium — gates the upsell below so it
  // never shows to someone who already has the feature (e.g. if a transient
  // Claude failure meant no plan came back for this particular session).
  const [isPremium, setIsPremium] = useState(false);
  const [upsellBusy, setUpsellBusy] = useState(false);
  const [upsellError, setUpsellError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    getReport(sessionId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    getBillingStatus()
      .then((status) => setIsPremium(status.plan?.id === "premium"))
      .catch(() => setIsPremium(false));
  }, [sessionId]);

  async function onUpgrade() {
    setUpsellBusy(true);
    setUpsellError(null);
    try {
      const { url } = await startCheckout("premium");
      window.location.href = url;
    } catch (err) {
      setUpsellError(err instanceof Error ? err.message : String(err));
      setUpsellBusy(false);
    }
  }

  if (loading) return <div className="card">Loading report…</div>;
  if (error) return <div className="card error">{error}</div>;
  if (!data) return <div className="card error">Report not found.</div>;

  const { session, questions, responses, result } = data;
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const responseByQuestionId = new Map(responses.map((r) => [r.questionId, r]));

  return (
    <div className="card">
      <h1>
        Report card <span className="muted">· {session.role} ({session.seniority})</span>
      </h1>

      <div className="overall-score">
        <div className="score-circle">{result.overallScore}</div>
        <p>{result.overallSummary}</p>
      </div>

      <div className="strengths-growth">
        <div>
          <h3>Top strengths</h3>
          <ul>
            {result.topStrengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Growth areas</h3>
          <ul>
            {result.topGrowthAreas.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>

      {result.improvementPlan ? (
        <>
          <h2>Your practice plan</h2>
          <div className="grade-block improvement-plan">
            <ul>
              {result.improvementPlan.focusAreas.map((area, i) => (
                <li key={i}>{area}</li>
              ))}
            </ul>
            <p className="muted">{result.improvementPlan.suggestedNextSessionFocus}</p>
          </div>
        </>
      ) : (
        !isPremium && (
          <div className="upsell-box">
            <div>
              <strong>Want a personalized practice plan?</strong>
              <p className="muted">
                Premium turns this report into a specific practice plan — concrete next steps tied
                to what actually happened in this session, plus what to schedule next.
              </p>
            </div>
            <button type="button" onClick={onUpgrade} disabled={upsellBusy} className="secondary">
              {upsellBusy ? "Redirecting…" : "Upgrade to Premium"}
            </button>
            {upsellError && <p className="error">{upsellError}</p>}
          </div>
        )
      )}

      <h2>Time management</h2>
      <div className="grade-block">
        <div className="score-row">
          <span>Scheduled: {result.timeManagement.scheduledMinutes} min</span>
          <span>
            Actual: {Math.round(result.timeManagement.actualMinutes)} min
            {" "}
            ({result.timeManagement.actualMinutes >= result.timeManagement.scheduledMinutes ? "+" : "−"}
            {Math.round(
              Math.abs(result.timeManagement.actualMinutes - result.timeManagement.scheduledMinutes),
            )}{" "}
            min)
          </span>
        </div>
        <p>{result.timeManagement.assessment}</p>
      </div>

      {result.presentation && (
        <>
          <h2>Presentation</h2>
          <div className="grade-block">
            <div className="score-row">
              <span>Attire: {result.presentation.attireScore}/100</span>
              <span>Framing &amp; lighting: {result.presentation.framingLightingScore}/100</span>
              <span>Eye contact: {result.presentation.eyeContactScore}/100</span>
            </div>
            <p>{result.presentation.attireFeedback}</p>
            <p>{result.presentation.framingLightingFeedback}</p>
            <p className="muted">{result.presentation.eyeContactFeedback}</p>
          </div>
        </>
      )}

      {result.composureUnderStress && (
        <>
          <h2>Composure under stress</h2>
          <div className="grade-block">
            <p>{result.composureUnderStress.overallNarrative}</p>
            {result.composureUnderStress.perStressQuestion.map((c) => (
              <div key={c.questionId} className="composure-row">
                <p className="muted question-text">{questionById.get(c.questionId)?.text}</p>
                <div className="score-row">
                  <span>Recovery: {c.recoveryScore}/100</span>
                </div>
                <p>{c.feedback}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Per-question breakdown</h2>
      {result.perQuestion.map((grade) => {
        const question = questionById.get(grade.questionId);
        const response = responseByQuestionId.get(grade.questionId);
        return (
          <div className="grade-block" key={grade.questionId}>
            <p className="question-text">{question?.text}</p>
            <p className="muted answer-preview">"{response?.transcript}"</p>
            <div className="score-row">
              <span>Content: {grade.contentScore}/100</span>
              <span>Structure: {grade.structureScore}/100</span>
            </div>
            <p>{grade.contentFeedback}</p>
            <p className="muted">{grade.structureFeedback}</p>
          </div>
        );
      })}

      <Link to="/" className="link-back">
        ← Start another mock interview
      </Link>
    </div>
  );
}
