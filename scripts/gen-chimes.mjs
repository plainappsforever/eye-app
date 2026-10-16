#!/usr/bin/env node
// Synthesises the four reminder/end-of-break sounds into assets/sounds/chime1..4.wav (G1).
// No dependencies, fully deterministic: re-running produces byte-identical files.
//   Bell (chime1) · Bowl (chime2) · Marimba (chime3) · Soft rise (chime4)
// Format: 44.1 kHz, 16-bit, mono, <= 1.5 s, peak -3 dBFS, 10 ms fade-in.
// Ids stay chime1..chime3 so a stored `exposure.sound` from v1 remains valid.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const PEAK = 10 ** (-3 / 20); // -3 dBFS
const FADE_IN_S = 0.01;
const FADE_OUT_S = 0.04; // avoids a click when the buffer ends

/** One struck tone: sum of inharmonic partials, each with its own exponential decay. */
function strike(buffer, { start, freq, partials, gain = 1 }) {
  const first = Math.floor(start * RATE);
  for (const { ratio, amp, tau, detune = 0 } of partials) {
    const f = freq * ratio + detune;
    for (let i = first; i < buffer.length; i++) {
      const t = (i - first) / RATE;
      const env = Math.exp(-t / tau);
      if (env < 1e-4) break;
      buffer[i] += gain * amp * env * Math.sin(2 * Math.PI * f * t);
    }
  }
}

// Each entry: [seconds, fill]. All <= 1.5 s.
const SOUNDS = {
  // Struck bell: inharmonic partials, bright attack, medium ring.
  chime1: [1.4, (b) =>
    strike(b, {
      start: 0,
      freq: 880,
      partials: [
        { ratio: 1, amp: 1, tau: 0.45 },
        { ratio: 2.76, amp: 0.55, tau: 0.3 },
        { ratio: 5.4, amp: 0.3, tau: 0.18 },
        { ratio: 8.93, amp: 0.15, tau: 0.1 },
      ],
    })],
  // Singing bowl: low, slow decay; two close frequencies per mode give a gentle beating.
  chime2: [1.5, (b) =>
    strike(b, {
      start: 0,
      freq: 396,
      partials: [
        { ratio: 1, amp: 1, tau: 0.6 },
        { ratio: 1, amp: 0.8, tau: 0.6, detune: 2.2 },
        { ratio: 2.71, amp: 0.45, tau: 0.4 },
        { ratio: 2.71, amp: 0.35, tau: 0.4, detune: 3.1 },
        { ratio: 5.15, amp: 0.18, tau: 0.22 },
      ],
    })],
  // Marimba: very short, woody, strong 4th-ish partial.
  chime3: [0.8, (b) =>
    strike(b, {
      start: 0,
      freq: 523.25,
      partials: [
        { ratio: 1, amp: 1, tau: 0.22 },
        { ratio: 3.93, amp: 0.4, tau: 0.07 },
        { ratio: 9.2, amp: 0.1, tau: 0.03 },
      ],
    })],
  // Soft rise: two gentle notes a fourth apart, the second one starting as the first fades.
  chime4: [1.3, (b) => {
    const soft = [
      { ratio: 1, amp: 1, tau: 0.32 },
      { ratio: 2.01, amp: 0.25, tau: 0.2 },
      { ratio: 3.02, amp: 0.08, tau: 0.12 },
    ];
    strike(b, { start: 0, freq: 587.33, partials: soft, gain: 0.8 });
    strike(b, { start: 0.28, freq: 783.99, partials: soft });
  }],
};

function render(fill, seconds) {
  const buffer = new Float64Array(Math.round(seconds * RATE));
  fill(buffer);
  const fadeIn = Math.round(FADE_IN_S * RATE);
  const fadeOut = Math.round(FADE_OUT_S * RATE);
  // Apply the fades first, then normalise, so the final peak is exactly PEAK.
  let max = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (i < fadeIn) buffer[i] *= i / fadeIn;
    if (i >= buffer.length - fadeOut) buffer[i] *= (buffer.length - 1 - i) / fadeOut;
    max = Math.max(max, Math.abs(buffer[i]));
  }
  const scale = PEAK / max;
  const pcm = Buffer.alloc(buffer.length * 2);
  for (let i = 0; i < buffer.length; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buffer[i] * scale)) * 32767), i * 2);
  }
  return pcm;
}

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');
mkdirSync(outDir, { recursive: true });
for (const [id, [seconds, fill]] of Object.entries(SOUNDS)) {
  const file = wav(render(fill, seconds));
  writeFileSync(join(outDir, `${id}.wav`), file);
  console.log(`${id}.wav  ${file.length} bytes`);
}
