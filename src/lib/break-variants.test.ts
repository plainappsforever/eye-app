import {
  BREAK_VARIANTS,
  DEFAULT_BREAK_VARIANT,
  MIX_ROTATION,
  VARIANT_INFO,
  formatBreakLength,
  instructionFor,
  nextMixIndex,
  parseBreakVariant,
  reminderAsk,
  resolveVariant,
  type BreakVariant,
} from './break-variants';

describe('reminder ask (v2.1 S10; same cases as BreakTextTest.kt)', () => {
  it('names the chosen type and the real break length', () => {
    expect(reminderAsk('far', 20_000)).toBe('Look far away for 20 seconds.');
    expect(reminderAsk('close', 30_000)).toBe('Close your eyes for 30 seconds.');
    expect(reminderAsk('blink', 10_000)).toBe('Blink slowly for 10 seconds.');
    expect(reminderAsk('stand', 60_000)).toBe('Stand up and look away for 1 minute.');
    expect(reminderAsk('mix', 3_000)).toBe('Rest your eyes for 3 seconds.');
    expect(reminderAsk('unknown' as BreakVariant, 400)).toBe('Look far away for 1 second.');
    expect(formatBreakLength(120_000)).toBe('2 minutes');
  });
});

describe('Mix rotation', () => {
  it('follows Look far, Blink, Look far, Close, Look far, Stand and then starts over', () => {
    const seen = [];
    let index = 0;
    for (let i = 0; i < 8; i++) {
      seen.push(resolveVariant('mix', index));
      index = nextMixIndex(index);
    }
    expect(seen).toEqual(['far', 'blink', 'far', 'close', 'far', 'stand', 'far', 'blink']);
  });

  it('nextMixIndex wraps and repairs bad values', () => {
    expect(nextMixIndex(5)).toBe(0);
    expect(nextMixIndex(-3)).toBe(1);
    expect(nextMixIndex(2.7)).toBe(3);
  });

  it('a fixed variant ignores the mix index', () => {
    expect(resolveVariant('blink', 3)).toBe('blink');
    expect(resolveVariant('mix', 11)).toBe(MIX_ROTATION[5]);
    expect(resolveVariant('mix', -1)).toBe(MIX_ROTATION[5]);
  });

  it('gives Mix the instruction of its current step', () => {
    expect(instructionFor('mix', 1)).toBe(VARIANT_INFO.blink.instruction);
    expect(instructionFor('mix', 5)).toBe(VARIANT_INFO.stand.instruction);
  });
});

describe('variants', () => {
  it('parses stored values, falling back to Look far', () => {
    expect(parseBreakVariant('blink')).toBe('blink');
    expect(parseBreakVariant('mix')).toBe('mix');
    expect(parseBreakVariant('nonsense')).toBe(DEFAULT_BREAK_VARIANT);
    expect(parseBreakVariant(null)).toBe('far');
  });

  it('every concrete variant has one short instruction line', () => {
    for (const variant of BREAK_VARIANTS.filter((v) => v !== 'mix')) {
      const line = VARIANT_INFO[variant].instruction;
      expect(typeof line).toBe('string');
      expect((line as string).length).toBeGreaterThan(10);
      expect((line as string).length).toBeLessThan(80);
    }
  });

  // D15 / SPEC principle "No medical claims": these words must never appear in an evidence note.
  it('evidence notes make no medical claims and every note names its limits', () => {
    const banned = /\b(proven|proves|prove|protects?|prevents?|prevention|treats?|treatment for|cures?|heals?|guarantee[sd]?|clinically|diagnos\w*)\b/i;
    for (const variant of BREAK_VARIANTS) {
      const { note } = VARIANT_INFO[variant];
      const withoutDisclaimer = note.replace('not a treatment', '');
      expect(withoutDisclaimer).not.toMatch(banned);
    }
    expect(VARIANT_INFO.blink.note).toMatch(/small/i);
    expect(VARIANT_INFO.close.note).toMatch(/low evidence/i);
    expect(VARIANT_INFO.stand.note).toMatch(/not eye-specific/i);
    expect(VARIANT_INFO.far.note).toMatch(/faded/i);
  });

  it('every study link is https and non-empty', () => {
    for (const variant of BREAK_VARIANTS) {
      for (const link of VARIANT_INFO[variant].links) {
        expect(link.url).toMatch(/^https:\/\//);
        expect(link.label.length).toBeGreaterThan(3);
      }
    }
  });
});

describe('native overlay copy (G9, BreakText.kt)', () => {
  it('uses the same instruction lines and Mix rotation as the break screen', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    const kotlin = fs.readFileSync(
      `${__dirname}/../../modules/exposure-monitor/android/src/main/java/expo/modules/exposuremonitor/BreakText.kt`,
      'utf8'
    );
    for (const variant of ['far', 'blink', 'close', 'stand'] as const) {
      expect(kotlin).toContain(`"${variant}" to "${VARIANT_INFO[variant].instruction}"`);
    }
    expect(kotlin).toContain(`listOf(${MIX_ROTATION.map((v) => `"${v}"`).join(', ')})`);
  });
});
