import { Router } from "express";
import * as store from "../db/store.js";

// Deliberately signed-out-reachable — every page reads brand copy before
// anyone's identified (App.tsx's header renders on every route, including
// the landing page). Covered by the same globalApiLimiter every /api/*
// route already gets; no dedicated limiter needed for a read-only GET.
export const brandRouter = Router();

brandRouter.get("/override", async (_req, res) => {
  let overrideVariant: string | null = null;
  try {
    overrideVariant = await store.getBrandOverride();
  } catch (err) {
    // Same posture as routes/experiments.ts: a DB hiccup on this
    // pre-auth, hit-on-every-page-load route must never surface to the
    // caller or (per that file's earlier fix) crash the process — fall
    // back to "no override" rather than 500ing.
    console.warn("Failed to read brand override:", err);
  }
  res.json({ overrideVariant });
});
