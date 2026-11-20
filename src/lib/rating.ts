import Constants from 'expo-constants';
import * as StoreReview from 'expo-store-review';

import { getSetting, setSetting } from '@/db/settings';
import { getAllStats } from '@/db/stats';
import type { Db } from '@/db/types';

/** The review prompt waits for real use: the tenth completed break (eye or move), counted from the stored history. */
export const REVIEW_AFTER_BREAKS = 10;
/** Settings key holding the app version that was last asked. A plain setting, never part of any backup or export. */
export const REVIEW_ASKED_KEY = 'review.asked_version';

/** Pure decision: enough completed breaks and not yet asked in this app version. */
export function shouldAskForReview(completedBreaks: number, askedVersion: string | null, version: string): boolean {
  return completedBreaks >= REVIEW_AFTER_BREAKS && askedVersion !== version;
}

/**
 * Called when the home screen is in front again (never from the break screen, never at first launch: a new install
 * has no breaks yet). Asks at most once per app version; the OS may still choose not to show the sheet.
 */
export async function maybeAskForReview(db: Db): Promise<boolean> {
  const version = Constants.expoConfig?.version ?? '0';
  const [rows, asked] = await Promise.all([getAllStats(db), getSetting(db, REVIEW_ASKED_KEY)]);
  const completed = rows.reduce((sum, r) => sum + r.taken + r.moveDone, 0);
  if (!shouldAskForReview(completed, asked, version)) return false;
  if (!(await StoreReview.hasAction())) return false;
  await setSetting(db, REVIEW_ASKED_KEY, version);
  await StoreReview.requestReview();
  return true;
}
