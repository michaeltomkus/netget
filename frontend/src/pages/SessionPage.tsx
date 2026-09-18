import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getSession, gradeSession, submitResponse } from "../api/client";
import type { CandidateQuestion, Session } from "../api/types";

const TYPE_LABEL: Record<CandidateQuestion["type"], string> = {
  behavioral: "Behavioral",
  technical: "Technical",
  out_of_box: "Out-of-the-box",
  stress: "Stress test",
};

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<CandidateQuestion[]>([]);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId)
      .then(({ session, questions, responses }) => {
        setSession(session);
        setQuestions(questions);
        const answered = new Set(responses.map((r) => r.questionId));
        setAnsweredIds(answered);
        const firstUnanswered = questions.findIndex((q) => !answered.has(q.id));
        setCurrentIndex(firstUnanswered === -1 ? questions.length : firstUnanswered);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <div className="card">Loading session…</div>;
  if (error) return <div className="card error">{error}</div>;
  if (!session) return <div className="card error">Session not found.</div>;

  const currentQuestion = questions[currentIndex];
  const allAnswered = currentIndex >= questions.length;

  async function onSubmitAnswer() {
    if (!sessionId || !currentQuestion || !answer.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitResponse(sessionId, currentQuestion.id, answer.trim());
      setAnsweredIds((prev) => new Set(prev).add(currentQuestion.id));
      setAnswer("");
      setCurrentIndex((i) => i + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onFinish() {
    if (!sessionId) return;
    setFinishing(true);
    setError(null);
    try {
      await gradeSession(sessionId);
      navigate(`/session/${sessionId}/report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFinishing(false);
    }
  }

  return (
    <div className="card">
      <div className="session-meta">
        <h1>
          {session.role} <span className="muted">· {session.seniority}</span>
        </h1>
        <p className="muted">
          Question {Math.min(currentIndex + 1, questions.length)} of {questions.length}
        </p>
      </div>

      {!allAnswered && currentQuestion && (
        <div className="question-block">
          <span className={`badge badge-${currentQuestion.type}`}>
            {TYPE_LABEL[currentQuestion.type]}
          </span>
          <p className="question-text">{currentQuestion.text}</p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer as you'd say it out loud…"
            rows={8}
          />
          {error && <p className="error">{error}</p>}
          <button onClick={onSubmitAnswer} disabled={submitting || !answer.trim()}>
            {submitting ? "Saving…" : "Submit answer"}
          </button>
        </div>
      )}

      {allAnswered && (
        <div className="question-block">
          <p>All {questions.length} questions answered.</p>
          {error && <p className="error">{error}</p>}
          <button onClick={onFinish} disabled={finishing}>
            {finishing ? "Grading your session…" : "Finish & get report card"}
          </button>
        </div>
      )}
    </div>
  );
}
