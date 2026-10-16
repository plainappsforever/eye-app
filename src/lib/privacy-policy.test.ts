import { PRIVACY_POLICY_URL, PRIVACY_SECTIONS } from './privacy-policy';

// RELEASE_KIT 1c row 12: the in-app policy says what v2.1 does (L26).
const text = PRIVACY_SECTIONS.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.bullets ?? []), ...(s.after ?? [])]).join('\n');

it('points to the privacy page on the Plain Apps site', () => {
  expect(PRIVACY_POLICY_URL).toMatch(/^https:\/\/plainapps\.dfdsfdsfsdf\.workers\.dev\//);
});

it('names every permission the app can ask for', () => {
  for (const name of ['Notifications', 'Display over other apps', 'Usage Access', 'Physical activity', 'Motion & Fitness', 'Foreground service']) {
    expect(text).toContain(name);
  }
});

it('matches allowBackup=false and step counts not kept in the history', () => {
  expect(text).toContain('asks Android not to include its data in your Google backup');
  expect(text).toContain('Step counts are not kept in the history');
  expect(text).not.toMatch(/count of steps may be stored/i);
});
