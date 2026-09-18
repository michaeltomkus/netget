import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getReport } from "../api/client";
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

  useEffect(() => {
    if (!sessionId) return;
    getReport(sessionId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [sessionId]);

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
