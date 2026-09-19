import { clerkMiddleware, clerkClient, getAuth, verifyToken } from "@clerk/express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import * as store from "../db/store.js";
import type { User } from "../types.js";

// Clerk owns the OAuth flow (Google + whatever other providers are enabled
// in the Clerk dashboard), token verification, and session security — we
// never see a password or a raw provider token, only a verified identity.
// clerkMiddleware() is a no-op passthrough (req.auth stays unauthenticated)
// if CLERK_SECRET_KEY isn't set, same graceful-degradation pattern as every
// other provider integration in this app; requireAuth below is what
// actually enforces login.
export const clerkAuth: RequestHandler = clerkMiddleware();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by requireAuth once the caller's identity is verified and provisioned locally. */
      appUser?: User;
    }
  }
}

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Upserts the local User row for a verified Clerk identity. Lazy
 * provisioning on first authenticated request — no Clerk webhook needed for
 * account creation, only for out-of-band changes (not implemented here).
 */
async function provisionUser(clerkUserId: string, email: string, name?: string): Promise<User> {
  const role = ADMIN_EMAILS.has(email.toLowerCase()) ? "admin" : undefined;
  return store.upsertUserFromClerk({ clerkUserId, email, name, role });
}

async function getClerkIdentity(clerkUserId: string): Promise<{ email: string; name?: string }> {
  const user = await clerkClient.users.getUser(clerkUserId);
  const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress;
  if (!email) throw new Error(`Clerk user ${clerkUserId} has no primary email`);
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
  return { email, name };
}

/** Express middleware: 401s if not signed in; otherwise attaches req.appUser. */
export function requireAuth(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // getAuth() throws if clerkMiddleware() never ran on this request, which
    // index.ts only mounts when CLERK_SECRET_KEY is set — check first so an
    // unconfigured deployment 503s cleanly instead of 500ing.
    if (!process.env.CLERK_SECRET_KEY) {
      return res.status(503).json({ error: "Sign-in is not configured" });
    }
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: "Sign in required" });
    }
    try {
      const identity = await getClerkIdentity(auth.userId);
      req.appUser = await provisionUser(auth.userId, identity.email, identity.name);
      next();
    } catch (err) {
      console.error("Failed to resolve authenticated user:", err);
      res.status(502).json({ error: "Failed to verify identity" });
    }
  };
}

/**
 * Verifies a Clerk session token passed out-of-band (the STT WebSocket
 * gateway can't rely on clerkMiddleware()'s normal request-pipeline
 * verification — `ws`'s upgrade handling bypasses Express entirely — so the
 * frontend sends a short-lived token in the "start" message instead, and
 * this verifies it directly against Clerk's backend API).
 */
export async function verifyWsToken(token: string): Promise<User | undefined> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return undefined;
  try {
    const payload = await verifyToken(token, { secretKey });
    const identity = await getClerkIdentity(payload.sub);
    return await provisionUser(payload.sub, identity.email, identity.name);
  } catch (err) {
    console.warn("WS token verification failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
