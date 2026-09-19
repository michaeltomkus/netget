import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { setTokenGetter } from "./tokenBridge";

// Keeps tokenBridge's module-level getToken reference in sync with Clerk's
// current session. Renders nothing — mount once inside <ClerkProvider>.
export default function AuthBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setTokenGetter(getToken);
    return () => setTokenGetter(undefined);
  }, [getToken]);

  return null;
}
