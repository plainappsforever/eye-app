import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';
import { getSetting } from '@/db/settings';
import { recordBreakTaken, recordMoveDone } from '@/db/stats';

import { maybeAskForReview, REVIEW_ASKED_KEY, shouldAskForReview } from './rating';

const mockRequest = jest.fn();
jest.mock('expo-store-review', () => ({
  hasAction: jest.fn(async () => true),
  requestReview: (...a: unknown[]) => mockRequest(...a),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '2.2.0' } } }));

describe('review prompt', () => {
  it('decides on count and version', () => {
    expect(shouldAskForReview(9, null, '2.2.0')).toBe(false);
    expect(shouldAskForReview(10, null, '2.2.0')).toBe(true);
    expect(shouldAskForReview(30, '2.2.0', '2.2.0')).toBe(false);
    expect(shouldAskForReview(30, '2.1.0', '2.2.0')).toBe(true);
  });

  it('asks once after the tenth completed break, never on a fresh install', async () => {
    const db = createTestDb();
    await migrate(db);
    expect(await maybeAskForReview(db)).toBe(false);
    for (let i = 0; i < 7; i++) await recordBreakTaken(db);
    for (let i = 0; i < 2; i++) await recordMoveDone(db);
    expect(await maybeAskForReview(db)).toBe(false);
    await recordBreakTaken(db);
    expect(await maybeAskForReview(db)).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(await getSetting(db, REVIEW_ASKED_KEY)).toBe('2.2.0');
    await recordBreakTaken(db);
    expect(await maybeAskForReview(db)).toBe(false);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
