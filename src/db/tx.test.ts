/**
 * @jest-environment node
 */
// The template's write-queue cases (mobile-starter src/db/tx.test.ts), on this app's tables (L27).
import { createTestDb } from '../../test/node-sqlite-db';

import { addEvent, listRecentEvents } from './events';
import { migrate } from './migrations';
import { getSetting, setSetting } from './settings';
import { withTransaction, withWrite } from './tx';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

async function types(db: Awaited<ReturnType<typeof freshDb>>) {
  return (await listRecentEvents(db)).map((e) => e.meta).sort();
}

describe('write queue', () => {
  it('(a) keeps a write issued during a failing transaction', async () => {
    const db = await freshDb();
    const failing = withTransaction(db, async (tx) => {
      await tx.runAsync("INSERT INTO events (ts, type, meta) VALUES (1, 'snoozed', 'inside')");
      await tick();
      throw new Error('boom');
    });
    const outside = tick().then(() => addEvent(db, 'snoozed', 'outside', 2));
    const setting = setSetting(db, 'k', 'v'); // issued while the transaction is open
    await expect(failing).rejects.toThrow('boom');
    await outside;
    await setting;

    expect(await types(db)).toEqual(['outside']);
    expect(await getSetting(db, 'k')).toBe('v');
  });

  it('(b) a second transaction started during one waits instead of throwing', async () => {
    const db = await freshDb();
    const order: string[] = [];
    const first = withTransaction(db, async (tx) => {
      await addEvent(tx, 'snoozed', 'one', 1);
      await tick();
      order.push('first done');
    });
    const second = withTransaction(db, async (tx) => {
      order.push('second start');
      await addEvent(tx, 'snoozed', 'two', 2);
    });
    await Promise.all([first, second]);

    expect(order).toEqual(['first done', 'second start']);
    expect(await types(db)).toEqual(['one', 'two']);
  });

  it('(c) a failing migration leaves no open transaction and user_version unchanged', async () => {
    const db = createTestDb();
    await migrate(db, ['CREATE TABLE a (id INTEGER);']);
    await expect(
      migrate(db, ['CREATE TABLE a (id INTEGER);', 'CREATE TABLE b (id INTEGER); INSERT INTO nope VALUES (1);'])
    ).rejects.toThrow();

    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(1);
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'b'")).toBeNull();
    await db.execAsync('BEGIN; COMMIT;'); // throws if a transaction were still open
  });

  it('nested transactions join the outer one; an inner failure undoes only the inner part', async () => {
    const db = await freshDb();
    await withTransaction(db, async (tx) => {
      await addEvent(tx, 'snoozed', 'outer', 1);
      await expect(
        withTransaction(tx, async (inner) => {
          await addEvent(inner, 'snoozed', 'inner', 2);
          throw new Error('inner');
        })
      ).rejects.toThrow('inner');
      await withTransaction(tx, (inner) => addEvent(inner, 'snoozed', 'kept', 3));
    });
    expect(await types(db)).toEqual(['kept', 'outer']);
  });

  it('rejects a handle used after its unit ended', async () => {
    const db = await freshDb();
    let leaked!: Parameters<Parameters<typeof withWrite>[1]>[0];
    await withWrite(db, async (tx) => {
      leaked = tx;
    });
    expect(() => leaked.runAsync('SELECT 1')).toThrow('after its write unit ended');
  });
});
