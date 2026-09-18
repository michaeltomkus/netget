export type AvatarState = "idle" | "speaking";

interface AvatarRendererProps {
  state: AvatarState;
}

// V1: static image + a "transmitting" indicator driven by <audio> play/pause
// events (see SessionPage). V2 (future, out of scope per docs/ARCHITECTURE.md
// §6 Phase 7) swaps this for a generated talking-head video behind the same
// `state` prop — callers never need to change when that swap happens.
export default function AvatarRenderer({ state }: AvatarRendererProps) {
  const speaking = state === "speaking";
  return (
    <div className={`avatar ${speaking ? "avatar-speaking" : ""}`}>
      <img src="/avatar-placeholder.svg" alt="Interviewer avatar" />
      <span
        className={`avatar-indicator ${speaking ? "on" : ""}`}
        aria-label={speaking ? "Interviewer speaking" : "Interviewer idle"}
      />
    </div>
  );
}
