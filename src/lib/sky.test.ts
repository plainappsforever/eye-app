import { skyAlphaHex, skyFill } from './sky';

describe('sky', () => {
  it('fills as the break gets closer', () => {
    expect(skyFill(20 * 60_000, 20 * 60_000)).toBe(0);
    expect(skyFill(10 * 60_000, 20 * 60_000)).toBe(0.5);
    expect(skyFill(0, 20 * 60_000)).toBe(1);
  });
  it('clamps and handles missing values', () => {
    expect(skyFill(null, 60_000)).toBe(0);
    expect(skyFill(-5, 60_000)).toBe(1);
    expect(skyFill(90_000, 60_000)).toBe(0);
    expect(skyFill(1000, 0)).toBe(0);
  });
  it('maps fill to 25 to 60 percent opacity', () => {
    expect(skyAlphaHex(0)).toBe('40');
    expect(skyAlphaHex(1)).toBe('99');
  });
});
