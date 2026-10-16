/** G10 "Don't count these apps": pure helpers for the app picker (unit-tested). */
import type { LaunchableApp } from './exposure-module';

/** The ticked packages: what the user chose, or — never chosen yet — the navigation apps
 * (`ApplicationInfo.CATEGORY_MAPS`), which start ticked (D47). */
export function initialSelection(apps: readonly LaunchableApp[], stored: readonly string[] | null): string[] {
  if (stored !== null) return [...stored];
  return apps.filter((app) => app.isNavigation).map((app) => app.packageName);
}

/** Case-insensitive search on the label and the package name. */
export function filterApps(apps: readonly LaunchableApp[], query: string): LaunchableApp[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...apps];
  return apps.filter((app) => app.label.toLowerCase().includes(q) || app.packageName.toLowerCase().includes(q));
}

export function toggleApp(selection: readonly string[], packageName: string): string[] {
  return selection.includes(packageName) ? selection.filter((p) => p !== packageName) : [...selection, packageName];
}

/** "Maps", "Maps and Waze", "Maps, Waze and 2 more"; labels for installed apps, else the package. */
export function selectionSummary(apps: readonly LaunchableApp[], selection: readonly string[]): string {
  if (selection.length === 0) return 'No apps chosen';
  const labels = selection.map((p) => apps.find((app) => app.packageName === p)?.label ?? p);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`;
}
