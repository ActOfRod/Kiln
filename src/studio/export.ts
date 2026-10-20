export interface ExportOptions {
  format: "wav" | "mp3";
  source: "arrange" | "session";
  bitrate: 128 | 192 | 320;
  startBar: number;
  endBar: number;
  tail: boolean;
}

export function pcm16(data: Float32Array): Int16Array {
  const output = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const value = Math.max(-1, Math.min(1, data[i] ?? 0));
    output[i] = Math.round(value * (value < 0 ? 32768 : 32767));
  }
  return output;
}

export async function encodeMp3(
  buffer: Pick<AudioBuffer, "sampleRate" | "getChannelData">,
  bitrate: 128 | 192 | 320,
): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(2, buffer.sampleRate, bitrate);
  const left = pcm16(buffer.getChannelData(0));
  const right = pcm16(buffer.getChannelData(1));
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < left.length; offset += 1152) {
    const chunk = encoder.encodeBuffer(
      left.subarray(offset, offset + 1152),
      right.subarray(offset, offset + 1152),
    );
    if (chunk.length) chunks.push(new Uint8Array(chunk).buffer);
    if (offset % (1152 * 128) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const last = encoder.flush();
  if (last.length) chunks.push(new Uint8Array(last).buffer);
  return new Blob(chunks, { type: "audio/mpeg" });
}
