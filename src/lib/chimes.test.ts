/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// G1: scripts/gen-chimes.mjs output format — 44.1 kHz, 16-bit, mono, <= 1.5 s, peak -3 dBFS.
describe.each(['chime1', 'chime2', 'chime3', 'chime4'])('assets/sounds/%s.wav', (id) => {
  const wav = readFileSync(join(__dirname, '..', '..', 'assets', 'sounds', `${id}.wav`));

  it('is 44.1 kHz 16-bit mono PCM no longer than 1.5 s', () => {
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(44100);
    expect(wav.readUInt16LE(34)).toBe(16);
    const seconds = wav.readUInt32LE(40) / 2 / 44100;
    expect(seconds).toBeGreaterThan(0.3);
    expect(seconds).toBeLessThanOrEqual(1.5);
  });

  it('peaks at -3 dBFS and fades in from silence', () => {
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    const dbfs = 20 * Math.log10(peak / 32767);
    expect(dbfs).toBeGreaterThan(-3.1);
    expect(dbfs).toBeLessThan(-2.9);
    expect(wav.readInt16LE(44)).toBe(0); // first sample: start of the 10 ms fade-in
  });
});
