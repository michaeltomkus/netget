import "dotenv/config";
import express from "express";
import cors from "cors";
import { sessionsRouter } from "./routes/sessions.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: corsOrigin.split(",").map((o) => o.trim()) }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.use("/api/sessions", sessionsRouter);

app.listen(port, () => {
  console.log(`InterviewAI mock-interview backend listening on :${port}`);
});
