import type { ActiveNudge } from "../hooks/useLiveNudges";

interface LiveNudgeOverlayProps {
  nudges: ActiveNudge[];
}

// Fixed-position, low-opacity, pointer-events-none corner badges — never a
// modal, never layout-shifting, never something that demands attention
// mid-answer. Per docs/ARCHITECTURE.md §4.4's UX constraint.
export default function LiveNudgeOverlay({ nudges }: LiveNudgeOverlayProps) {
  if (nudges.length === 0) return null;
  return (
    <div className="nudge-overlay" aria-live="polite">
      {nudges.map((nudge) => (
        <span key={nudge.kind} className="nudge-pill">
          {nudge.message}
        </span>
      ))}
    </div>
  );
}
