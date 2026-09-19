import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

// Keys by the authenticated user when there is one (req.appUser is only set
// after requireAuth() has run — see routes/sessions.ts), falling back to IP
// for unauthenticated routes. User-keying matters specifically for the
// "leaked token" threat model: an attacker using a stolen token from a
// different IP than the legitimate user would otherwise dodge an IP-only
// limit entirely. The IP fallback goes through express-rate-limit's own
// ipKeyGenerator() rather than raw req.ip, which normalizes IPv6 addresses
// to a /56 subnet — otherwise a single IPv6 user could roll through an
// effectively unlimited number of distinct keys and dodge the limit too.
function userOrIpKey(req: Request): string {
  return req.appUser?.id ?? ipKeyGenerator(req.ip ?? "unknown");
}

// A coarse floor across every /api/* route, IP-keyed since it also covers
// requests before any auth has resolved (health checks, public pricing).
export const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// The two genuinely expensive actions — each call spends real Anthropic
// (and, for creation, Azure/Deepgram pre-synthesis) tokens — get their own
// tighter, user-keyed limits on top of the global one. Free-tier session
// creation is already capped at 3/month by billing.ts; this is a backstop
// against a compromised Pro/Premium account or a scripted loop, not the
// primary usage control.
export const createSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: "Too many sessions created — please wait a few minutes and try again." },
});

export const gradeSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: "Too many grading requests — please wait a few minutes and try again." },
});
