/**
 * audioUtils.js — Audio encoding helpers
 */

/**
 * Encode a Float32Array of mono PCM samples to a WAV ArrayBuffer.
 * Produces 16-bit signed little-endian PCM, which Azure Speech SDK accepts natively.
 *
 * @param {Float32Array} samples  Normalised samples in the range [-1, 1]
 * @param {number}       sampleRate  Sample rate in Hz (e.g. 44100 or 48000)
 * @returns {ArrayBuffer}
 */
export function encodeWAV(samples, sampleRate) {
  const numChannels  = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;        // 2
  const blockAlign    = numChannels * bytesPerSample; // 2
  const byteRate      = sampleRate * blockAlign;      // bytes/sec
  const dataBytes     = samples.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view   = new DataView(buffer);

  let pos = 0;

  const writeStr = (s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos++, s.charCodeAt(i));
  };
  const u16 = (v) => { view.setUint16(pos, v, true); pos += 2; };
  const u32 = (v) => { view.setUint32(pos, v, true); pos += 4; };
  const i16 = (v) => { view.setInt16(pos, v, true);  pos += 2; };

  // ---- RIFF header ----
  writeStr('RIFF');
  u32(36 + dataBytes); // total file size - 8 bytes
  writeStr('WAVE');

  // ---- fmt chunk ----
  writeStr('fmt ');
  u32(16);             // chunk size (PCM = 16)
  u16(1);              // audio format (PCM)
  u16(numChannels);
  u32(sampleRate);
  u32(byteRate);
  u16(blockAlign);
  u16(bitsPerSample);

  // ---- data chunk ----
  writeStr('data');
  u32(dataBytes);

  // ---- PCM samples (Float32 → Int16) ----
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    i16(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
  }

  return buffer;
}

/**
 * Return a CSS class suffix ('green' | 'yellow' | 'red') for a 0–100 score.
 * @param {number} score
 */
export function scoreClass(score) {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}
