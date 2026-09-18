import { useCallback, useEffect, useRef, useState } from "react";
import { detectFace } from "../services/faceLandmarks";
import { iosStandaloneHint } from "../utils/platform";
import type { PresentationSignals } from "../api/types";

export type CaptureStatus = "idle" | "requesting" | "active" | "denied" | "unsupported";

const SAMPLE_INTERVAL_MS = 15000;
const MAX_FRAMES = 8;
const CANVAS_MAX_WIDTH = 480;

interface RunningAggregate {
  frameCount: number;
  faceDetectedCount: number;
  faceSignalSamples: number; // samples where the landmark model actually returned a result
  offCenterSum: number;
  offCenterSamples: number;
  brightnessSum: number;
}

export interface UsePresentationCaptureResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CaptureStatus;
  frames: string[];
  signals: PresentationSignals | null;
  error: string | null;
  stop: () => void;
}

/**
 * Manages a session-level (not per-question) camera stream: self-preview,
 * plus periodic sampling that captures a JPEG frame and computes cheap
 * on-device signals (brightness always; face-presence/gaze proxy when the
 * landmark model loaded successfully — see services/faceLandmarks.ts).
 * Frames + signals are only ever read by the caller at Finish time and POSTed
 * once as a batch; this hook never uploads anything itself.
 */
export function usePresentationCapture(active: boolean): UsePresentationCaptureResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const aggregateRef = useRef<RunningAggregate>({
    frameCount: 0,
    faceDetectedCount: 0,
    faceSignalSamples: 0,
    offCenterSum: 0,
    offCenterSamples: 0,
    brightnessSum: 0,
  });

  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [frames, setFrames] = useState<string[]>([]);
  const [signals, setSignals] = useState<PresentationSignals | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus((s) => (s === "active" ? "idle" : s));
  }, []);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setError("Camera capture isn't supported in this browser.");
      return;
    }

    let cancelled = false;
    setStatus("requesting");

    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStatus("active");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("denied");
          setError(`Camera access was denied — presentation feedback will be skipped.${iosStandaloneHint()}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (status !== "active") return;

    const interval = setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;

      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      const canvas = canvasRef.current;
      const scale = Math.min(1, CANVAS_MAX_WIDTH / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let luminanceSum = 0;
      const pixelCount = imageData.length / 4;
      for (let i = 0; i < imageData.length; i += 4) {
        luminanceSum += 0.299 * imageData[i] + 0.587 * imageData[i + 1] + 0.114 * imageData[i + 2];
      }
      const brightness = luminanceSum / pixelCount;

      const face = await detectFace(canvas);

      const agg = aggregateRef.current;
      agg.frameCount += 1;
      agg.brightnessSum += brightness;
      if (face) {
        agg.faceSignalSamples += 1;
        if (face.detected) {
          agg.faceDetectedCount += 1;
          if (face.offCenterRatio !== undefined) {
            agg.offCenterSum += face.offCenterRatio;
            agg.offCenterSamples += 1;
          }
        }
      }

      setSignals({
        frameCount: agg.frameCount,
        faceDetectedRatio:
          agg.faceSignalSamples > 0 ? agg.faceDetectedCount / agg.faceSignalSamples : undefined,
        avgOffCenterRatio:
          agg.offCenterSamples > 0 ? agg.offCenterSum / agg.offCenterSamples : undefined,
        avgBrightness: agg.brightnessSum / agg.frameCount,
      });

      setFrames((prev) =>
        prev.length < MAX_FRAMES ? [...prev, canvas.toDataURL("image/jpeg", 0.7)] : prev,
      );
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, frames, signals, error, stop };
}
