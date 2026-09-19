import { Router } from "express";
import { getBrandOverrideSafe } from "../services/brand.js";

// Deliberately signed-out-reachable — every page reads brand copy before
// anyone's identified (App.tsx's header renders on every route, including
// the landing page). Covered by the same globalApiLimiter every /api/*
// route already gets; no dedicated limiter needed for a read-only GET.
export const brandRouter = Router();

// getBrandOverrideSafe() already applies the same posture as
// routes/experiments.ts: a DB hiccup on this pre-auth, hit-on-every-page-load
// route must never surface to the caller or (per that file's earlier fix)
// crash the process — it falls back to "no override" rather than 500ing.
brandRouter.get("/override", async (_req, res) => {
  const overrideVariant = await getBrandOverrideSafe();
  res.json({ overrideVariant });
});
