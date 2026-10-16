import { withTransaction } from './tx';
import type { Db } from './types';

// Append-only. Never edit a migration that has shipped; add a new one instead.
const MIGRATIONS: string[] = [
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
  `CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     type TEXT NOT NULL,
     meta TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX events_ts ON events(ts);
   CREATE TABLE daily_stats (
     date TEXT PRIMARY KEY NOT NULL,
     taken INTEGER NOT NULL DEFAULT 0,
     skipped INTEGER NOT NULL DEFAULT 0,
     snoozed INTEGER NOT NULL DEFAULT 0,
     longest_stretch_ms INTEGER NOT NULL DEFAULT 0
   );`,
  // v2 (SPEC "Data (migration 3)"): richer daily stats, aggregated from the event log in P4.
  `ALTER TABLE daily_stats ADD COLUMN screen_ms INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE daily_stats ADD COLUMN long_sessions INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE daily_stats ADD COLUMN session_count INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE daily_stats ADD COLUMN reminders INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE daily_stats ADD COLUMN unanswered INTEGER NOT NULL DEFAULT 0;`,
  // Move breaks (MOVE_SPEC §5 "Migration 4"): counts only; the Stats Move block reads them (P7c).
  `ALTER TABLE daily_stats ADD COLUMN move_reminders INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE daily_stats ADD COLUMN move_done INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE daily_stats ADD COLUMN move_noticed INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE daily_stats ADD COLUMN move_skipped INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE daily_stats ADD COLUMN move_snoozed INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE daily_stats ADD COLUMN combined_reminders INTEGER NOT NULL DEFAULT 0;`,
];

export const LATEST_VERSION = MIGRATIONS.length;

export async function migrate(db: Db, migrations: string[] = MIGRATIONS): Promise<void> {
  // The version is read INSIDE each unit: another JS handle on the same connection (a background task at a cold
  // start) may have migrated meanwhile, and a migration must never run twice (warranty-wallet D110). One transaction
  // per migration: a failure rolls back both the schema change and user_version.
  for (;;) {
    const applied = await withTransaction(db, async (tx) => {
      const row = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      const version = row?.user_version ?? 0;
      if (version >= migrations.length) return false;
      await tx.execAsync(`${migrations[version]} PRAGMA user_version = ${version + 1};`);
      return true;
    });
    if (!applied) return;
  }
}
