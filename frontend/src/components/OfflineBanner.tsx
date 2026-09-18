import { useOnlineStatus } from "../hooks/useOnlineStatus";

// The service worker keeps the app shell loading instantly offline (see
// vite.config.ts), but every real feature here — question generation,
// grading, live voice — needs the network. This banner is just honesty
// about that, not an offline-capable interview experience.
export default function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      You're offline. The app loaded from cache, but scheduling, voice answering, and grading all
      need a connection — reconnect to continue.
    </div>
  );
}
