/**
 * D15 + MOVE_SPEC M8 wording rules, enforced over every user-facing source file: evidence notes,
 * notification and widget texts, sheets, onboarding, About, Kotlin strings. The app reminds you to
 * rest your eyes and to stand up; it never claims to prevent, protect, treat or cure anything.
 */
import * as fs from 'fs';
import * as path from 'path';

import { MOVE_VARIANT_INFO } from './move-variants';
import { BREAK_VARIANTS, VARIANT_INFO } from './break-variants';
import { reminderContent } from './ios-reminders';

const root = path.resolve(__dirname, '../..');

const BANNED = new RegExp(
  [
    'prevents?',
    'prevention',
    'protects?',
    'treats?',
    'treatment for',
    'cures?',
    'heals?',
    'proven',
    'proves?',
    '(?<!not a )guarantee[sd]?',
    'clinically',
    'diagnos(e[sd]?|is|ing)',
    'reduces? (the )?risk',
    'undo(es)? (the )?(effects? of )?sitting',
    'offsets? (the )?(effects? of )?sitting',
    'burns? calories',
    'back pain',
    'neck pain',
    'posture',
    'new smoking',
    'adhd',
    'disease',
  ].map((w) => `\\b${w}\\b`).join('|'),
  'i'
);

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'build' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e)) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isComment = (line: string) => /^\s*(\/\/|\/\*|\*|<!--)/.test(line);

describe('wording (D15, MOVE_SPEC M8)', () => {
  const files = [
    ...walk(path.join(root, 'src'), ['.ts', '.tsx']),
    ...walk(path.join(root, 'modules/exposure-monitor/android/src/main'), ['.kt', '.xml']),
    path.join(root, 'app.config.ts'),
  ];

  it('scans the source tree (guards against an empty walk)', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('no user-facing line uses a banned health-claim word', () => {
    const hits: string[] = [];
    for (const file of files) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!isComment(line) && BANNED.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('every evidence note (eye and move) names its limits and none makes a claim', () => {
    for (const info of [...Object.values(VARIANT_INFO), ...Object.values(MOVE_VARIANT_INFO)]) {
      expect(info.note).not.toMatch(BANNED);
    }
  });

  it('the old app name is gone from user-facing strings', () => {
    const hits: string[] = [];
    for (const file of files) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!isComment(line) && /Eye App\b/.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  // v2.1 (REVIEW_V2 S9/S10, L26): sentences may not promise more than the code does.
  it('no sheet or text says data is "not stored" or "never leaves your phone" (the app keeps history)', () => {
    const hits: string[] = [];
    for (const file of files) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!isComment(line) && /not stored|never leaves? your (phone|device)|leaves your device/i.test(line)) {
            hits.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});

describe('notification bodies (REVIEW_V2 S10)', () => {
  const style = { strength: 'balanced' as const, sound: 'chime1' as const };

  it('iPhone timer reminders never claim screen time', () => {
    for (const kind of ['reminder', 'nudge', 'last', 'move', 'both'] as const) {
      expect(String(reminderContent(kind, 20 * 60_000, style).body)).not.toMatch(/screen time/i);
    }
  });

  it('the eye reminder names the chosen break type and length', () => {
    for (const variant of BREAK_VARIANTS) {
      for (const breakMs of [10_000, 20_000, 30_000, 60_000]) {
        const body = String(reminderContent('reminder', 20 * 60_000, { ...style, variant, breakMs }).body);
        expect(body).toMatch(breakMs === 60_000 ? /for 1 minute\.$/ : new RegExp(`for ${breakMs / 1000} seconds\\.$`));
      }
    }
    expect(reminderContent('reminder', 20 * 60_000, { ...style, variant: 'close', breakMs: 30_000 }).body).toBe(
      '20 minutes have passed. Close your eyes for 30 seconds.'
    );
  });

  it('the move reminder does not claim measured sitting', () => {
    expect(String(reminderContent('move', 20 * 60_000, style, { intervalMs: 45 * 60_000 }).body)).not.toMatch(/sitting/i);
  });
});
