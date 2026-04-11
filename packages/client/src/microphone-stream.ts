import type { LiveSessionManager } from "./live-session";

export type AttachMicOptions = {
  /** Return false to skip a chunk (e.g. live session torn down). */
  shouldSend?: () => boolean;
};

const MIC_WORKLET_NAME = "verity-microphone-capture";
const MIC_WORKLET_MODULE_URL = new URL("./microphone-capture.worklet.js", import.meta.url);

/**
 * Stream mic as 16 kHz PCM via `sendRealtimeInput` (Gemini Live requirement).
 * Always sends while connected — the Live session uses START_OF_ACTIVITY_INTERRUPTS for barge-in;
 * do not gate on local "speaking" state or the model will not hear you during playback.
 */
export async function attachMicrophoneToLiveSession(
  manager: LiveSessionManager,
  stream: MediaStream,
  options?: AttachMicOptions,
): Promise<() => void> {
  const audioContext = new AudioContext();
  async function ensureRunning() {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  }
  await ensureRunning();
  audioContext.addEventListener("statechange", () => {
    if (audioContext.state === "suspended") {
      void ensureRunning();
    }
  });

  const source = audioContext.createMediaStreamSource(stream);
  const mute = audioContext.createGain();
  mute.gain.value = 0;
  await audioContext.audioWorklet.addModule(MIC_WORKLET_MODULE_URL.href);
  const processor = new AudioWorkletNode(audioContext, MIC_WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });

  processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (options?.shouldSend && !options.shouldSend()) return;
    const input = event.data;
    const pcm16 = downsampleToPcm16(input, audioContext.sampleRate, 16000);
    if (pcm16.byteLength === 0) return;
    manager.sendAudioChunk(pcm16ToBase64(pcm16));
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);

  return () => {
    manager.sendAudioStreamEnd();
    processor.port.onmessage = null;
    processor.disconnect();
    source.disconnect();
    mute.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    audioContext.close().catch(() => undefined);
  };
}

function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) {
    return floatTo16BitPcm(input);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.round(input.length / ratio);
  const result = new Int16Array(outputLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;

    for (let index = offsetBuffer; index < nextOffsetBuffer && index < input.length; index += 1) {
      accum += input[index];
      count += 1;
    }

    const sample = count > 0 ? accum / count : 0;
    result[offsetResult] =
      Math.max(-1, Math.min(1, sample)) < 0
        ? Math.max(-32768, Math.min(32767, sample * 0x8000))
        : Math.max(-32768, Math.min(32767, sample * 0x7fff));
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function floatTo16BitPcm(input: Float32Array) {
  const result = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    result[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return result;
}
