// Client-side face-landmark signal extraction, per docs/ARCHITECTURE.md §2.3:
// runs entirely on-device (WebAssembly), so raw video never leaves the
// browser for this signal — only the small numeric summary derived here
// gets sent to the backend. This is a network-dependent feature (WASM +
// model file load from a CDN at runtime) that could not be interactively
// verified in the build environment (no browser, no camera available) — it
// is feature-detected and wrapped defensively so a failed/slow/offline load
// degrades to "signal unavailable" rather than breaking frame sampling,
// which has no such dependency.

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

// MediaPipe's 478-point face mesh: index 1 is the conventional nose-tip landmark.
const NOSE_TIP_INDEX = 1;

let landmarkerPromise: Promise<FaceLandmarker | null> | null = null;

function loadLandmarker(): Promise<FaceLandmarker | null> {
  if (!landmarkerPromise) {
    landmarkerPromise = FilesetResolver.forVisionTasks(WASM_BASE)
      .then((fileset) =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "IMAGE",
          numFaces: 1,
        }),
      )
      .catch((err) => {
        console.warn("Face landmark model unavailable, gaze/head-pose signal will be skipped:", err);
        return null;
      });
  }
  return landmarkerPromise;
}

export interface FaceSignal {
  detected: boolean;
  /** 0 (centered) to ~0.5+ (off to the side) — nose-offset-from-bbox-center proxy, not true gaze tracking. */
  offCenterRatio?: number;
}

/** Returns null if the model failed to load; a real caller should treat that as "signal unavailable", not "no face". */
export async function detectFace(source: CanvasImageSource): Promise<FaceSignal | null> {
  const landmarker = await loadLandmarker();
  if (!landmarker) return null;

  try {
    const result = landmarker.detect(source as HTMLCanvasElement);
    const landmarks = result.faceLandmarks[0];
    if (!landmarks || landmarks.length === 0) {
      return { detected: false };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    for (const point of landmarks) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
    }
    const bboxWidth = maxX - minX || 1;
    const bboxCenterX = (minX + maxX) / 2;
    const noseX = landmarks[NOSE_TIP_INDEX]?.x ?? bboxCenterX;
    const offCenterRatio = Math.abs(noseX - bboxCenterX) / bboxWidth;

    return { detected: true, offCenterRatio };
  } catch (err) {
    console.warn("Face landmark detection failed on a frame:", err);
    return null;
  }
}
