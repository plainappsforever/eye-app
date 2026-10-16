import type { LaunchableApp } from './exposure-module';
import { filterApps, initialSelection, selectionSummary, toggleApp } from './ignored-apps';

const APPS: LaunchableApp[] = [
  { label: 'Chrome', packageName: 'com.android.chrome', isNavigation: false },
  { label: 'Maps', packageName: 'com.google.android.apps.maps', isNavigation: true },
  { label: 'Settings', packageName: 'com.android.settings', isNavigation: false },
  { label: 'Waze', packageName: 'com.waze', isNavigation: true },
];

describe('ignored apps picker (G10)', () => {
  it('pre-ticks navigation apps only when nothing was chosen yet', () => {
    expect(initialSelection(APPS, null)).toEqual(['com.google.android.apps.maps', 'com.waze']);
    expect(initialSelection(APPS, [])).toEqual([]);
    expect(initialSelection(APPS, ['com.android.settings'])).toEqual(['com.android.settings']);
  });

  it('searches label and package, ignoring case and spaces', () => {
    expect(filterApps(APPS, '  set ').map((a) => a.label)).toEqual(['Settings']);
    expect(filterApps(APPS, 'WAZE').map((a) => a.label)).toEqual(['Waze']);
    expect(filterApps(APPS, 'apps.maps').map((a) => a.label)).toEqual(['Maps']);
    expect(filterApps(APPS, '')).toHaveLength(4);
    expect(filterApps(APPS, 'zzz')).toEqual([]);
  });

  it('toggles a package in and out', () => {
    expect(toggleApp([], 'com.waze')).toEqual(['com.waze']);
    expect(toggleApp(['com.waze', 'com.android.chrome'], 'com.waze')).toEqual(['com.android.chrome']);
  });

  it('summarises the choice in words', () => {
    expect(selectionSummary(APPS, [])).toBe('No apps chosen');
    expect(selectionSummary(APPS, ['com.google.android.apps.maps'])).toBe('Maps');
    expect(selectionSummary(APPS, ['com.google.android.apps.maps', 'com.waze'])).toBe('Maps and Waze');
    expect(selectionSummary(APPS, ['com.waze', 'com.android.chrome', 'gone.app', 'com.android.settings'])).toBe(
      'Waze, Chrome and 2 more'
    );
    expect(selectionSummary([], ['gone.app'])).toBe('gone.app');
  });
});
