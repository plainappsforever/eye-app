import { COMBINED_BODY, COMBINED_TITLE } from './move';
import {
  DEFAULT_MOVE_BREAK_MS,
  DEFAULT_MOVE_VARIANT,
  MOVE_BREAK_PRESETS_MIN,
  MOVE_MIX_ROTATION,
  MOVE_VARIANTS,
  MOVE_VARIANT_INFO,
  moveInstructionFor,
  nextMoveMixIndex,
  parseMoveVariant,
  resolveMoveVariant,
} from './move-variants';

describe('move types (MOVE_SPEC M4)', () => {
  it('Mix rotates Walk, Walk, Stretch and starts over', () => {
    const seen = [];
    let index = 0;
    for (let i = 0; i < 7; i++) {
      seen.push(resolveMoveVariant('mix', index));
      index = nextMoveMixIndex(index);
    }
    expect(seen).toEqual(['walk', 'walk', 'stretch', 'walk', 'walk', 'stretch', 'walk']);
  });

  it('nextMoveMixIndex wraps and repairs bad values; a fixed type ignores the index', () => {
    expect(nextMoveMixIndex(2)).toBe(0);
    expect(nextMoveMixIndex(-4)).toBe(1);
    expect(resolveMoveVariant('stretch', 0)).toBe('stretch');
    expect(resolveMoveVariant('walk', 2)).toBe('walk');
    expect(resolveMoveVariant('mix', -1)).toBe(MOVE_MIX_ROTATION[2]);
  });

  it('looks the instruction up for the type, or for the Mix step', () => {
    expect(moveInstructionFor('walk', 0)).toBe('Stand up and walk around for a minute or two.');
    expect(moveInstructionFor('stretch', 0)).toBe('Stand up, reach up tall and roll your shoulders slowly.');
    expect(moveInstructionFor('mix', 2)).toBe(MOVE_VARIANT_INFO.stretch.instruction);
    expect(moveInstructionFor('mix', 3)).toBe(MOVE_VARIANT_INFO.walk.instruction);
  });

  it('parses stored values, falling back to Walk; default length 2 min from 1 · 2 · 5', () => {
    expect(parseMoveVariant('stretch')).toBe('stretch');
    expect(parseMoveVariant('mix')).toBe('mix');
    expect(parseMoveVariant('nonsense')).toBe(DEFAULT_MOVE_VARIANT);
    expect(parseMoveVariant(null)).toBe('walk');
    expect(MOVE_BREAK_PRESETS_MIN).toEqual([1, 2, 5]);
    expect(DEFAULT_MOVE_BREAK_MS).toBe(2 * 60_000);
  });

  it('every type has an instruction line (Mix: none) and an evidence note with its limits and links', () => {
    for (const v of MOVE_VARIANTS) {
      const info = MOVE_VARIANT_INFO[v];
      if (v !== 'mix') {
        expect(info.instruction).toBeTruthy();
        expect((info.instruction as string).length).toBeLessThan(80);
        expect(info.links.length).toBeGreaterThan(0);
      }
      expect(info.note).toMatch(/small|not about|could not|does not|do not|each step/i);
    }
  });

  // BreakText.kt copies these two lines for the full-screen break (BreakTextTest has the same literals).
  it('the combined reminder texts are the ones the Android overlay repeats', () => {
    expect(COMBINED_TITLE).toBe('Time to stand up and look away');
    expect(COMBINED_BODY).toBe('Stand up, walk a little and look into the distance.');
  });
});
