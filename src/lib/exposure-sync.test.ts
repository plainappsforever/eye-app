/**
 * @jest-environment node
 */
// REVIEW_V2 S4 (D81): the Android outbox drain is all-or-nothing and acknowledges only what it stored.
import { createTestDb } from '../../test/node-sqlite-db';

import { listRecentEvents } from '@/db/events';
import { migrate } from '@/db/migrations';
import { dateKey, getStatsForDate } from '@/db/stats';

import type { OutboxEvent } from './exposure-module';
import { drainAndroidOutbox } from './exposure-sync';

const mockOutbox: OutboxEvent[] = [];
// Called after each read of the outbox (the service may append right then).
let mockAfterPeek: (() => void) | null = null;
const mockAck = jest.fn(async (count: number) => {
  mockOutbox.splice(0, count);
});

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('./exposure-module', () => ({
  ExposureModule: {
    peekEvents: async () => {
      const copy = mockOutbox.map((e) => ({ ...e }));
      mockAfterPeek?.();
      return copy;
    },
    ackEvents: (count: number) => mockAck(count),
  },
  toModuleSettings: () => ({}),
}));

const T = new Date(2026, 9, 1, 10, 0).getTime();

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

beforeEach(() => {
  mockOutbox.length = 0;
  mockAfterPeek = null;
  mockAck.mockClear();
});

it('stores a batch in one transaction and acknowledges exactly that batch', async () => {
  const db = await freshDb();
  mockOutbox.push({ type: 'reminder_fired', ts: T, meta: '' }, { type: 'break_done', ts: T + 1000, meta: '' });
  await drainAndroidOutbox(db);
  expect(mockAck).toHaveBeenCalledWith(2);
  expect(mockOutbox).toEqual([]);
  const day = await getStatsForDate(db, dateKey(T));
  expect([day.reminders, day.taken]).toEqual([1, 1]);
});

it('a failing write keeps the whole batch in the outbox and stores none of it', async () => {
  const db = await freshDb();
  mockOutbox.push({ type: 'reminder_fired', ts: T, meta: '' }, { type: 'snoozed', ts: T + 1000, meta: '' });
  await db.execAsync('ALTER TABLE daily_stats RENAME TO daily_stats_away;');
  await expect(drainAndroidOutbox(db)).rejects.toThrow();
  expect(mockAck).not.toHaveBeenCalled();
  expect(mockOutbox).toHaveLength(2);
  expect(await listRecentEvents(db)).toEqual([]); // rolled back, not half-applied

  await db.execAsync('ALTER TABLE daily_stats_away RENAME TO daily_stats;');
  await drainAndroidOutbox(db);
  const day = await getStatsForDate(db, dateKey(T));
  expect([day.reminders, day.snoozed]).toEqual([1, 1]);
  expect(mockOutbox).toEqual([]);
});

it('a batch stored but not acknowledged (JS killed) is not counted twice', async () => {
  const db = await freshDb();
  mockOutbox.push({ type: 'break_taken', ts: T, meta: '' });
  mockAck.mockImplementationOnce(async () => {
    throw new Error('process died before the ack');
  });
  await expect(drainAndroidOutbox(db)).rejects.toThrow('process died');
  expect(mockOutbox).toHaveLength(1);

  await drainAndroidOutbox(db);
  expect((await getStatsForDate(db, dateKey(T))).taken).toBe(1);
  expect(await listRecentEvents(db)).toHaveLength(1);
  expect(mockOutbox).toEqual([]);
});

it('overlapping drains never acknowledge an event they did not read', async () => {
  const db = await freshDb();
  mockOutbox.push({ type: 'snoozed', ts: T, meta: '' });
  let peeks = 0;
  // The service appends a second event right after the SECOND read: unqueued, both drains would
  // have read only the first event and the second ack would drop the new one unseen.
  mockAfterPeek = () => {
    peeks++;
    if (peeks === 2) mockOutbox.push({ type: 'snoozed', ts: T + 5000, meta: '' });
  };
  await Promise.all([drainAndroidOutbox(db), drainAndroidOutbox(db)]);
  const stored = (await getStatsForDate(db, dateKey(T))).snoozed;
  expect(stored + mockOutbox.length).toBe(2);
  await drainAndroidOutbox(db);
  expect((await getStatsForDate(db, dateKey(T))).snoozed).toBe(2);
});
