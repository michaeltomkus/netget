import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { getMe } from "../api/client";
import type { AppUser } from "../api/types";

// Wraps GET /api/me — the backend-provisioned user row (id, role, etc.),
// distinct from Clerk's own useUser() which only knows the Clerk-side
// identity. Used to gate the admin dashboard link/route.
export function useAppUser(): { user: AppUser | null; loading: boolean } {
  const { isSignedIn } = useAuth();
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSignedIn) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    getMe()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [isSignedIn]);

  return { user, loading };
}
