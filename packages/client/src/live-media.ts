import { createScreenShareHandle, type ScreenShareHandle } from "./screen-share";

export type LiveCaptureResources = {
  screenShare: ScreenShareHandle;
  microphoneStream: MediaStream;
};

export async function requestLiveCaptureResources(): Promise<LiveCaptureResources> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen sharing is unavailable in this browser. Use a recent Chrome, Edge, or Safari build.");
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is unavailable in this browser.");
  }

  const screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });

  try {
    const microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const screenShare = await createScreenShareHandle({ stream: screenStream });
    return { screenShare, microphoneStream };
  } catch (error) {
    screenStream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}
