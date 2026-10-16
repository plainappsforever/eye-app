import { isInCallWith } from './call-observer';

describe('isInCallWith (G5, iOS break-screen check)', () => {
  it('reports what the native observer says', async () => {
    await expect(isInCallWith({ isInCall: async () => true })).resolves.toBe(true);
    await expect(isInCallWith({ isInCall: async () => false })).resolves.toBe(false);
  });

  it('never blocks a break when the module is missing or fails', async () => {
    await expect(isInCallWith(null)).resolves.toBe(false);
    await expect(
      isInCallWith({
        isInCall: async () => {
          throw new Error('boom');
        },
      })
    ).resolves.toBe(false);
  });
});
