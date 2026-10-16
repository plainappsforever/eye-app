/**
 * Maps the device manufacturer (Android `Build.MANUFACTURER`) to its dontkillmyapp.com page
 * (D46, docs/RESEARCH.md §9.2 — pages verified live on 2026-09-30; /honor, /nothing and /redmi are
 * 404, so those map elsewhere). Unknown manufacturers get the site's general page. Pure: no network.
 */
const BASE_URL = 'https://dontkillmyapp.com';

const SLUGS: Record<string, string> = {
  google: 'google',
  samsung: 'samsung',
  xiaomi: 'xiaomi',
  redmi: 'xiaomi',
  poco: 'xiaomi',
  oneplus: 'oneplus',
  oppo: 'oppo',
  realme: 'realme',
  vivo: 'vivo',
  iqoo: 'vivo',
  huawei: 'huawei',
  honor: 'huawei', // no page of its own; same EMUI/MagicOS lineage (assumption, D46)
  motorola: 'motorola',
  'hmd global': 'hmd-global',
  hmd: 'hmd-global',
  nokia: 'hmd-global',
  sony: 'sony',
  asus: 'asus',
  meizu: 'meizu',
  lenovo: 'lenovo',
  tecno: 'tecno',
  htc: 'htc',
  wiko: 'wiko',
  blackview: 'blackview',
  ulefone: 'ulefone',
  unihertz: 'unihertz',
};

const FALLBACK_SLUG = 'general';

export function manufacturerSlug(manufacturer: string): string {
  const key = manufacturer.trim().toLowerCase().replace(/\s+/g, ' ');
  return SLUGS[key] ?? FALLBACK_SLUG;
}

export function manufacturerHelpUrl(manufacturer: string): string {
  return `${BASE_URL}/${manufacturerSlug(manufacturer)}`;
}
