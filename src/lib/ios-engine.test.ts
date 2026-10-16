/**
 * @jest-environment node
 */
// REVIEW_V2 S15: the iOS engine's glue (which ladder is armed from which anchor, what each answer
// stores) with fakes for notifications, surfaces, Screen Time and the pedometer; the real database.
import { createTestDb } from '../../test/node-sqlite-db';

import { listRecentEvents } from '@/db/events';
import { getExposureSettings, setExposureSettings } from '@/db/exposure-settings';
import { migrate } from '@/db/migrations';
import { getSetting } from '@/db/settings';
import { dateKey, getStatsForDate } from '@/db/stats';

import * as Engine from './ios-engine';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { appVariant: 'preview' } } } }));

const mockN = {
  permission: true,
  calls: [] as { fn: string; args: unknown[] }[],
};
jest.mock('./notifications', () => {
  const record =
    (fn: string, result?: (...a: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      mockN.calls.push({ fn, args });
      return result ? result(...args) : undefined;
    };
  return {
    registerNotificationInfrastructure: record('registerNotificationInfrastructure'),
    armPauseNotice: record('armPauseNotice'),
    cancelAllNotifications: record('cancelAllNotifications'),
    hasNotificationPermission: async () => mockN.permission,
    // A one-entry ladder: the first reminder one interval after the anchor.
    armLadder: record('armLadder', (anchor, interval) => [{ fireAt: (anchor as number) + (interval as number), kind: 'reminder' }]),
    armSingleReminder: record('armSingleReminder'),
    getDeliveredReminders: async () => [],
    dismissDelivered: record('dismissDelivered'),
  };
});
jest.mock('./ios-surfaces', () => ({ publishIosSurfaces: jest.fn(async () => undefined) }));
jest.mock('./screen-time-native', () => ({
  screenTimeFlagEnabled: false,
  getScreenTimeAuth: () => 'notDetermined',
  startScreenTime: async () => false,
  stopScreenTime: () => undefined,
}));
const mockPedometer = { value: null as unknown };
jest.mock('./ios-pedometer', () => ({ loadPedometer: async () => mockPedometer.value }));
const mockMoveCheck = { value: null as unknown };
jest.mock('./ios-move-detect', () => ({ checkIosMove: async () => mockMoveCheck.value }));

const MIN = 60_000;
const NOW = new Date(2026, 9, 1, 10, 0).getTime();

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

const ladderCalls = () => mockN.calls.filter((c) => c.fn === 'armLadder');
const lastLadderAnchor = () => ladderCalls().at(-1)?.args[0] as number | undefined;
const moveAnchor = async (db: Awaited<ReturnType<typeof freshDb>>) => Number(await getSetting(db, 'ios.move_anchor_at'));

beforeEach(() => {
  mockN.permission = true;
  mockN.calls = [];
  mockPedometer.value = null;
  mockMoveCheck.value = null;
});

describe('armFromNow', () => {
  it('off: cancels everything and arms nothing', async () => {
    const db = await freshDb();
    await setExposureSettings(db, { countingEnabled: false });
    await Engine.armFromNow(db, NOW);
    expect(mockN.calls.map((c) => c.fn)).toContain('cancelAllNotifications');
    expect(ladderCalls()).toHaveLength(0);
    expect(await Engine.getNextReminderAt(db)).toBeNull();
  });

  it('paused: only the pause notice, next reminder = the end of the pause', async () => {
    const db = await freshDb();
    await setExposureSettings(db, { pausedUntil: NOW + 30 * MIN });
    await Engine.armFromNow(db, NOW);
    expect(mockN.calls.find((c) => c.fn === 'armPauseNotice')?.args[0]).toBe(NOW + 30 * MIN);
    expect(ladderCalls()).toHaveLength(0);
    expect(await Engine.getNextReminderAt(db)).toBe(NOW + 30 * MIN);
  });

  it('no notification permission: nothing armed', async () => {
    const db = await freshDb();
    mockN.permission = false;
    await Engine.armFromNow(db, NOW);
    expect(ladderCalls()).toHaveLength(0);
    expect(await Engine.getNextReminderAt(db)).toBeNull();
  });

  it('counting: the ladder from now, with a move stream that starts a missing sitting anchor now', async () => {
    const db = await freshDb();
    await Engine.armFromNow(db, NOW);
    expect(lastLadderAnchor()).toBe(NOW);
    const options = ladderCalls()[0].args[3] as { move: { anchorAt: number } | null; eyeEnabled: boolean };
    expect(options.eyeEnabled).toBe(true);
    expect(options.move?.anchorAt).toBe(NOW);
    expect(await Engine.getNextReminderAt(db)).toBe(NOW + 20 * MIN);
  });

  it('move breaks off: no move stream', async () => {
    const db = await freshDb();
    await setExposureSettings(db, { moveEnabled: false });
    await Engine.armFromNow(db, NOW);
    expect((ladderCalls()[0].args[3] as { move: unknown }).move).toBeNull();
  });
});

describe('answers', () => {
  it('snooze: the next reminder comes after the snooze length', async () => {
    const db = await freshDb();
    await Engine.snooze(db, NOW);
    expect(lastLadderAnchor()! + 20 * MIN).toBe(NOW + 5 * MIN);
    expect((await getStatsForDate(db, dateKey(NOW))).snoozed).toBe(1);
  });

  it('combined snooze: both streams come back after the snooze length', async () => {
    const db = await freshDb();
    await Engine.combinedSnooze(db, NOW);
    const { moveIntervalMs } = await getExposureSettings(db);
    expect((await moveAnchor(db)) + moveIntervalMs).toBe(NOW + 5 * MIN);
    expect(lastLadderAnchor()! + 20 * MIN).toBe(NOW + 5 * MIN);
    const day = await getStatsForDate(db, dateKey(NOW));
    expect([day.snoozed, day.moveSnoozed]).toEqual([1, 1]);
  });

  it('move snooze: the move reminder is due again after the snooze length', async () => {
    const db = await freshDb();
    await Engine.moveSnooze(db, NOW);
    const { moveIntervalMs } = await getExposureSettings(db);
    expect((await moveAnchor(db)) + moveIntervalMs).toBe(NOW + 5 * MIN);
  });

  it('I moved: a new sitting stretch from now, counted as moved', async () => {
    const db = await freshDb();
    await Engine.moveDone(db, NOW);
    expect(await moveAnchor(db)).toBe(NOW);
    expect(await Engine.getLastMovedAt(db)).toBe(NOW);
    expect((await getStatsForDate(db, dateKey(NOW))).moveDone).toBe(1);
  });

  it('Done on a combined reminder is also "I moved"; Skip on it skips both', async () => {
    const db = await freshDb();
    await Engine.notificationDone(db, NOW, true);
    await Engine.notificationSkip(db, NOW + MIN, true);
    const day = await getStatsForDate(db, dateKey(NOW));
    expect([day.taken, day.moveDone, day.skipped, day.moveSkipped]).toEqual([1, 1, 1, 1]);
  });

  it('a finished Stand up break restarts the move clock only when move breaks are on', async () => {
    const db = await freshDb();
    await Engine.breakTaken(db, NOW, true);
    expect(await moveAnchor(db)).toBe(NOW);
    await setExposureSettings(db, { moveEnabled: false });
    await Engine.breakTaken(db, NOW + 10 * MIN, true);
    expect(await moveAnchor(db)).toBe(NOW);
  });
});

describe('noticeMoves (opt-in step detection) before a rebuild', () => {
  async function detectingDb() {
    const db = await freshDb();
    await setExposureSettings(db, { moveDetectEnabled: true });
    await Engine.startMoveStretch(db, NOW - 30 * MIN);
    mockPedometer.value = {};
    return db;
  }

  it('none: nothing changes', async () => {
    const db = await detectingDb();
    mockMoveCheck.value = { outcome: 'none' };
    await Engine.armFromNow(db, NOW);
    expect(await moveAnchor(db)).toBe(NOW - 30 * MIN);
  });

  it('noticed: the stretch restarts when you walked', async () => {
    const db = await detectingDb();
    mockMoveCheck.value = { outcome: 'noticed', movedAt: NOW - 10 * MIN, steps: 120, removeIds: [] };
    await Engine.armFromNow(db, NOW);
    expect(await moveAnchor(db)).toBe(NOW - 10 * MIN);
    const event = (await listRecentEvents(db)).find((e) => e.type === 'move_noticed');
    expect(event && JSON.parse(event.meta).at).toBe(NOW - 10 * MIN);
    expect((await getStatsForDate(db, dateKey(NOW))).moveNoticed).toBe(1);
  });

  it('answer: a delivered move reminder is removed and counted as noticed', async () => {
    const db = await detectingDb();
    mockMoveCheck.value = { outcome: 'answer', movedAt: NOW - 2 * MIN, steps: 60, removeIds: ['m1'] };
    await Engine.armFromNow(db, NOW);
    expect(mockN.calls.find((c) => c.fn === 'dismissDelivered')?.args[0]).toEqual(['m1']);
    const event = (await listRecentEvents(db)).find((e) => e.type === 'move_done');
    expect(event?.meta).toBe('steps');
  });

  it('feature off: the pedometer is never asked', async () => {
    const db = await detectingDb();
    await setExposureSettings(db, { moveDetectEnabled: false });
    mockMoveCheck.value = { outcome: 'noticed', movedAt: NOW - 10 * MIN, steps: 120, removeIds: [] };
    await Engine.armFromNow(db, NOW);
    expect(await moveAnchor(db)).toBe(NOW - 30 * MIN);
  });
});
