// Browser audio helpers for the Gemini Live demo.
// Gemini Live takes 16 kHz mono 16-bit PCM in and sends 24 kHz PCM back.

// Runs on the audio thread: downsamples the mic to 16 kHz and posts
// ~100 ms chunks of Int16 PCM back to the page.
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.buf = new Int16Array(1600);
    this.len = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
      this.buf[this.len++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.len === this.buf.length) {
        this.port.postMessage(this.buf.buffer.slice(0));
        this.len = 0;
      }
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export type Mic = { stop: () => void; level: () => number };

// Starts the microphone and calls onChunk with base64 16 kHz PCM.
export async function startMic(onChunk: (b64: string) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw err;
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture");
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const samples = new Uint8Array(analyser.fftSize);
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(toBase64(e.data));
  // Some browsers only run a worklet that leads to the speakers, so route it
  // there through a muted gain.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(ctx.destination);
  source.connect(analyser);
  return {
    stop() {
      node.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
    // 0..1 loudness for the mic button ring.
    level() {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v - 128));
      return peak / 128;
    },
  };
}

// Plays Gemini's 24 kHz PCM replies back to back; clear() stops at once
// (used when the user talks over the model).
export class Player {
  private ctx = new AudioContext({ sampleRate: 24000 });
  private at = 0;
  private playing = new Set<AudioBufferSourceNode>();

  play(b64: string) {
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length >> 1);
    for (let i = 0; i < pcm.length; i++) {
      const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      pcm[i] = v;
    }
    const buf = this.ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    this.at = Math.max(this.at, this.ctx.currentTime + 0.05);
    src.start(this.at);
    this.at += buf.duration;
    this.playing.add(src);
    src.onended = () => this.playing.delete(src);
  }

  clear() {
    for (const s of this.playing) s.stop();
    this.playing.clear();
    this.at = 0;
  }

  close() {
    this.clear();
    void this.ctx.close();
  }
}
