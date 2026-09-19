import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE, getSession, gradeSession, submitPresentationData, submitResponse } from "../api/client";
import { useSpeechToText } from "../hooks/useSpeechToText";
import { useLiveNudges } from "../hooks/useLiveNudges";
import { usePresentationCapture } from "../hooks/usePresentationCapture";
import AvatarRenderer, { AvatarState } from "../components/AvatarRenderer";
import LiveNudgeOverlay from "../components/LiveNudgeOverlay";
import ScheduledWaitRoom from "../components/ScheduledWaitRoom";
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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
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
  // Questions are audio-only — never shown as text on screen — so if
  // autoplay is blocked, the candidate relies on the always-visible "Replay
  // question" button below rather than a text fallback.
  useEffect(() => {
    setAvatarState("idle");
    interruptionAudioRef.current?.pause();
    stt.reset();
    if (!currentQuestion?.ttsAudioBlobRef) return;
    const audioEl = audioRef.current;
    if (!audioEl) return;
    audioEl.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

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

  // A freshly-approved role's first-ever booking — waiting out its
  // 5-minute buffer while the question set generates in the background.
  // See routes/sessions.ts and ScheduledWaitRoom.
  if (session.status === "scheduled") {
    return (
      <ScheduledWaitRoom
        session={session}
        onReady={(startedSession, startedQuestions) => {
          setSession(startedSession);
          setQuestions(startedQuestions);
        }}
      />
    );
  }

  const allAnswered = currentIndex >= questions.length;
  const recordedAnswer = stt.finalText.trim();
  const canSubmit = stt.status === "stopped" && recordedAnswer.length > 0;
  const questionHasAudio = Boolean(currentQuestion?.ttsAudioBlobRef);

  async function onSubmitAnswer() {
    if (!sessionId || !currentQuestion || !recordedAnswer) return;
    setSubmitting(true);
    setError(null);
    try {
      const dynamicFollowUps =
        stt.interruptions.length > 0
          ? stt.interruptions.map((i) => ({ triggerType: "live_interruption" as const, text: i.text }))
          : undefined;
      await submitResponse(sessionId, currentQuestion.id, recordedAnswer, dynamicFollowUps);
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
              <AvatarRenderer state={avatarState} audioRefs={[audioRef, interruptionAudioRef]} />
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
                {/* Questions are audio-only, like a real interview — never shown as
                    text on screen. This exists only for screen-reader users, who
                    already rely on a non-visual channel to "hear" the page. */}
                <span className="sr-only">{currentQuestion.text}</span>
                {questionHasAudio && (
                  <>
                    <audio
                      key={currentQuestion.id}
                      ref={audioRef}
                      src={`${API_BASE}${currentQuestion.ttsAudioBlobRef}`}
                      onPlay={() => setAvatarState("speaking")}
                      onPause={() => setAvatarState("idle")}
                      onEnded={() => setAvatarState("idle")}
                    />
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => audioRef.current?.play()}
                    >
                      🔊 Replay question
                    </button>
                  </>
                )}
              </div>
            </div>

            {!questionHasAudio ? (
              <div className="voice-blocked">
                <p className="error">Question audio unavailable</p>
                <p className="muted">
                  This session delivers questions by voice only — there's no text shown on
                  screen. This question's audio wasn't generated (the interviewer voice
                  service may be unavailable or failed for this question), so it can't be
                  delivered. Start a new session once voice is configured and working.
                </p>
              </div>
            ) : (
              <>
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

                {/* Voice is the only response modality — no text input. Recording
                    state drives everything below; there is no editable field. */}
                {stt.status === "error" ? (
                  <div className="voice-blocked">
                    <p className="error">
                      Voice answering is unavailable for this session: {stt.error}
                    </p>
                    <p className="muted">
                      This mock interview requires a spoken response — there is no text input.
                      Check your microphone/browser permissions, then try again.
                    </p>
                    <button type="button" className="secondary" onClick={() => stt.start()}>
                      Try again
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="answer-controls">
                      {stt.status === "idle" && (
                        <button type="button" className="secondary" onClick={() => stt.start()}>
                          🎙 Start answering
                        </button>
                      )}
                      {stt.status === "connecting" && (
                        <button type="button" className="secondary" disabled>
                          Connecting…
                        </button>
                      )}
                      {stt.status === "recording" && (
                        <button type="button" className="secondary recording" onClick={() => stt.stop()}>
                          ⏹ Stop recording
                        </button>
                      )}
                      {stt.status === "stopped" && (
                        <button type="button" className="secondary" onClick={() => stt.start()}>
                          🔁 Record again
                        </button>
                      )}
                      {stt.status === "recording" && (
                        <span className="live-indicator">● live transcript</span>
                      )}
                    </div>

                    <div className="transcript-display">
                      {recordedAnswer || stt.interimText ? (
                        <>
                          {recordedAnswer}
                          {stt.interimText && (
                            <span className="interim-preview"> {stt.interimText}</span>
                          )}
                        </>
                      ) : (
                        <span className="muted">
                          Nothing recorded yet — click "Start answering" and speak your response.
                        </span>
                      )}
                    </div>
                  </>
                )}

                {error && <p className="error">{error}</p>}
                {stt.status !== "error" && (
                  <button onClick={onSubmitAnswer} disabled={submitting || !canSubmit}>
                    {submitting ? "Saving…" : "Submit answer"}
                  </button>
                )}
              </>
            )}
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
