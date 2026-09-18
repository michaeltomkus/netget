import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { sessionsRouter } from "./routes/sessions.js";
import { attachSttGateway } from "./gateway/sttGateway.js";
import { MEDIA_DIR } from "./services/media.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: corsOrigin.split(",").map((o) => o.trim()) }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasTts: Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
    hasStt: Boolean(process.env.DEEPGRAM_API_KEY),
  });
});

app.use("/api/sessions", sessionsRouter);
app.use("/media", express.static(MEDIA_DIR));

const server = createServer(app);
attachSttGateway(server);

server.listen(port, () => {
  console.log(`InterviewAI mock-interview backend listening on :${port}`);
});
