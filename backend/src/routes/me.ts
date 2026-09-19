import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

export const meRouter = Router();

meRouter.use(requireAuth());

meRouter.get("/", (req, res) => {
  res.json({ user: req.appUser });
});
