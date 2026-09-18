import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE, getSession, gradeSession, submitPresentationData, submitResponse } from "../api/client";
import { useSpeechToText } from "../hooks/useSpeechToText";
import { useLiveNudges } from "../hooks/useLiveNudges";
import { usePresentationCapture } from "../hooks/usePresentationCapture";
import AvatarRenderer, { AvatarState } from "../components/AvatarRenderer";
import LiveNudgeOverlay from "../components/LiveNudgeOverlay";
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const interruptionAudioRef = useRef<HTMLAudioElement>(null);

  const currentQuestion = questions[currentIndex];
  const stt = useSpeechToText(sessionId, currentQuestion?.id);
  const nudges = useLiveNudges(stt.status === "recording", stt.finalText, stt.interimText);
  // Session-level, not per-question: starts once consent + session are known
  // and stays active (self-preview + periodic sampling) across all questions
  // until Finish.
  const presentation = usePresentationCapture(Boolean(session?.recordingConsent));

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId)
      .then(({ session, questions, responses }) => {
        setSession(session);
        setQuestions(questions);
        const answered = new Set(responses.map((r) => r.questionId));
        const firstUnanswered = questions.findIndex((q) => !answered.has(q.id));
        setCurrentIndex(firstUnanswered === -1 ? questions.length : firstUnanswered);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // Reset per-question UI state and try to auto-play the interviewer's voice.
  // Browsers can block autoplay if too much time passed since the last user
  // gesture; audioBlocked drives a manual "Play question" fallback for that.
  useEffect(() => {
    setAnswer("");
    setAudioBlocked(false);
    setAvatarState("idle");
    interruptionAudioRef.current?.pause();
    stt.reset();
    if (!currentQuestion?.ttsAudioBlobRef) return;
    const audioEl = audioRef.current;
    if (!audioEl) return;
    audioEl.play().catch(() => setAudioBlocked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  // While recording, mirror the live transcript into the editable answer
  // field; once stopped, the candidate can still hand-edit before submitting.
  useEffect(() => {
    if (stt.status === "recording") setAnswer(stt.finalText);
  }, [stt.finalText, stt.status]);

  // A new live interruption arrived from the Interview Conductor — play its
  // audio (if TTS was configured) through a dedicated element so it doesn't
  // fight with the question-audio element's play/pause wiring, and drive the
  // avatar the same way question audio does.
  useEffect(() => {
    if (stt.interruptions.length === 0) return;
    const latest = stt.interruptions[stt.interruptions.length - 1];
    const audioEl = interruptionAudioRef.current;
    if (latest.audioDataUrl && audioEl) {
      audioEl.src = latest.audioDataUrl;
      audioEl.play().catch(() => {});
    }
  }, [stt.interruptions.length]);

  if (loading) return <div className="card">Loading session…</div>;
  if (error) return <div className="card error">{error}</div>;
  if (!session) return <div className="card error">Session not found.</div>;

  const allAnswered = currentIndex >= questions.length;

  async function onSubmitAnswer() {
    if (!sessionId || !currentQuestion || !answer.trim()) return;
    if (stt.status === "recording") stt.stop();
    setSubmitting(true);
    setError(null);
    try {
      const dynamicFollowUps =
        stt.interruptions.length > 0
          ? stt.interruptions.map((i) => ({ triggerType: "live_interruption" as const, text: i.text }))
          : undefined;
      await submitResponse(sessionId, currentQuestion.id, answer.trim(), dynamicFollowUps);
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
      if (session?.recordingConsent && presentation.frames.length > 0 && presentation.signals) {
        await submitPresentationData(sessionId, presentation.frames, presentation.signals);
      }
      presentation.stop();
      await gradeSession(sessionId);
      navigate(`/session/${sessionId}/report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFinishing(false);
    }
  }

  return (
    <>
      <LiveNudgeOverlay nudges={nudges} />
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
            <div className="interview-stage">
              <AvatarRenderer state={avatarState} />
              {session.recordingConsent && (
                <div className="self-preview">
                  <video ref={presentation.videoRef} autoPlay muted playsInline />
                  <span className="self-preview-label">You</span>
                  {presentation.error && <span className="self-preview-error">{presentation.error}</span>}
                </div>
              )}
              <div className="stage-text">
                <span className={`badge badge-${currentQuestion.type}`}>
                  {TYPE_LABEL[currentQuestion.type]}
                </span>
                <p className="question-text">{currentQuestion.text}</p>
                {currentQuestion.ttsAudioBlobRef && (
                  <>
                    <audio
                      key={currentQuestion.id}
                      ref={audioRef}
                      src={`${API_BASE}${currentQuestion.ttsAudioBlobRef}`}
                      onPlay={() => setAvatarState("speaking")}
                      onPause={() => setAvatarState("idle")}
                      onEnded={() => setAvatarState("idle")}
                    />
                    {audioBlocked && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => audioRef.current?.play().then(() => setAudioBlocked(false))}
                      >
                        ▶ Play question
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="answer-controls">
              {stt.status !== "recording" ? (
                <button type="button" className="secondary" onClick={() => stt.start()}>
                  🎙 Start answering
                </button>
              ) : (
                <button type="button" className="secondary recording" onClick={() => stt.stop()}>
                  ⏹ Stop recording
                </button>
              )}
              {stt.status === "recording" && (
                <span className="live-indicator">● live transcript</span>
              )}
              {stt.interimText && <span className="interim-preview">{stt.interimText}</span>}
              {stt.error && <p className="muted">{stt.error}</p>}
            </div>

            <audio
              ref={interruptionAudioRef}
              onPlay={() => setAvatarState("speaking")}
              onPause={() => setAvatarState("idle")}
              onEnded={() => setAvatarState("idle")}
            />
            {stt.interruptions.length > 0 && (
              <div className="interruption-banner">
                <strong>Interviewer interrupts:</strong>{" "}
                {stt.interruptions[stt.interruptions.length - 1].text}
              </div>
            )}

            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your answer appears here as you speak — or just type it."
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
    </>
  );
}
