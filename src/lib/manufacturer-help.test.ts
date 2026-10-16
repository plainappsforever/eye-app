import { manufacturerHelpUrl, manufacturerSlug } from './manufacturer-help';

describe('manufacturerSlug', () => {
  it.each([
    ['Google', 'google'],
    ['samsung', 'samsung'],
    ['Xiaomi', 'xiaomi'],
    ['Redmi', 'xiaomi'],
    ['POCO', 'xiaomi'],
    ['OnePlus', 'oneplus'],
    ['OPPO', 'oppo'],
    ['realme', 'realme'],
    ['vivo', 'vivo'],
    ['iQOO', 'vivo'],
    ['HUAWEI', 'huawei'],
    ['HONOR', 'huawei'],
    ['motorola', 'motorola'],
    ['HMD Global', 'hmd-global'],
    ['Nokia', 'hmd-global'],
    ['Sony', 'sony'],
    ['asus', 'asus'],
    ['Meizu', 'meizu'],
    ['LENOVO', 'lenovo'],
    ['TECNO', 'tecno'],
    ['HTC', 'htc'],
    ['Wiko', 'wiko'],
    ['Blackview', 'blackview'],
    ['Ulefone', 'ulefone'],
    ['Unihertz', 'unihertz'],
  ])('%s -> %s', (manufacturer, slug) => {
    expect(manufacturerSlug(manufacturer)).toBe(slug);
  });

  it('ignores case, surrounding and repeated spaces', () => {
    expect(manufacturerSlug('  hmd   GLOBAL ')).toBe('hmd-global');
  });

  it('maps manufacturers without a page (and unknown or empty ones) to the general page', () => {
    expect(manufacturerSlug('Nothing')).toBe('general');
    expect(manufacturerSlug('Fairphone')).toBe('general');
    expect(manufacturerSlug('')).toBe('general');
  });

  it('never produces a slug known to be a 404 on dontkillmyapp.com', () => {
    for (const m of ['honor', 'nothing', 'redmi']) {
      expect(['honor', 'nothing', 'redmi']).not.toContain(manufacturerSlug(m));
    }
  });
});

describe('manufacturerHelpUrl', () => {
  it('builds the dontkillmyapp.com URL', () => {
    expect(manufacturerHelpUrl('Xiaomi')).toBe('https://dontkillmyapp.com/xiaomi');
    expect(manufacturerHelpUrl('Fairphone')).toBe('https://dontkillmyapp.com/general');
  });
});
