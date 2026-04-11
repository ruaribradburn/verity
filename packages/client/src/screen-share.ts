import type { LiveSessionManager } from "./live-session";

export type ScreenShareHandle = {
  captureFrame(): string | null;
  startStreaming(manager: LiveSessionManager): void;
  stop(): void;
};

type ScreenShareOptions = {
  stream?: MediaStream;
};

/** Wait until the captured display produces frames (avoids null first capture). */
async function waitForVideoDimensions(video: HTMLVideoElement, timeoutMs = 8000) {
  const start = Date.now();
  while (video.videoWidth === 0 || video.videoHeight === 0) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

async function waitForVideoReady(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  await new Promise<void>((resolve) => {
    const onLoadedMetadata = () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadeddata", onLoadedMetadata);
      resolve();
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    video.addEventListener("loadeddata", onLoadedMetadata, { once: true });
  });
}

export async function createScreenShareHandle(
  options?: ScreenShareOptions,
): Promise<ScreenShareHandle> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen sharing is unavailable in this browser. Use a recent Chrome, Edge, or Safari build.");
  }

  const stream =
    options?.stream ??
    (await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    }));

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await waitForVideoReady(video);
  await video.play().catch(() => undefined);
  await waitForVideoDimensions(video);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable for screen capture.");
  }
  const drawContext = context;

  let interval: number | null = null;

  function captureFrame() {
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const width = 1280;
    const scale = width / video.videoWidth;
    canvas.width = width;
    canvas.height = Math.max(720, Math.round(video.videoHeight * scale));
    drawContext.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72).split(",")[1] ?? null;
  }

  const stop = () => {
    if (interval != null) {
      window.clearInterval(interval);
      interval = null;
    }
    video.pause();
    video.srcObject = null;
    stream.getTracks().forEach((track) => track.stop());
  };

  stream.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });

  return {
    captureFrame() {
      return captureFrame() ?? null;
    },
    startStreaming(manager) {
      const initialFrame = captureFrame();
      if (initialFrame) {
        manager.sendVideoFrame(initialFrame);
      }

      interval = window.setInterval(() => {
        const frame = captureFrame();
        if (frame) {
          manager.sendVideoFrame(frame);
        }
      }, 1000);
    },
    stop,
  };
}
