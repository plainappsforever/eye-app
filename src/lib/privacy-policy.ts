/**
 * RELEASE_KIT 1c row 12 / Appendix D (D92): the privacy policy shipped inside the app, so it reads
 * offline and is the same text as the web page. Apple 5.1.1 and Play's User Data policy want the
 * policy reachable in the app. Owner placeholders: the web address (taulon.org, not deployed yet),
 * provider name and postal address — fill them before a store upload. Wording: L26, D15 (no claims).
 */
export const PRIVACY_POLICY_URL = 'https://taulon.org/eye-rest-move/privacy/';
export const PRIVACY_CONTACT = 'info@taulon.org';
export const PRIVACY_LAST_UPDATED = '1 October 2026';
export const PRIVACY_PROVIDER = '[DEVELOPER NAME], [POSTAL ADDRESS]';

export type PolicySection = { heading: string; paragraphs: string[]; bullets?: string[]; after?: string[] };

export const PRIVACY_SECTIONS: readonly PolicySection[] = [
  {
    heading: 'In short',
    paragraphs: [
      'The app does not collect, transmit or share personal data. It has no account, no ads, no analytics and no tracking. The app itself makes no network requests. What it stores stays on your phone.',
    ],
  },
  {
    heading: 'What the app stores on your phone',
    paragraphs: [],
    bullets: [
      'Your settings (interval, break length, strength, hours, break types, sounds, which features are on).',
      'Your break history: when a reminder or break happened and how you answered (start, snooze, done, skip, moved), and daily counters.',
      "If you use \"Don't count these apps\" (Android): the apps you chose, and when one of them paused the count.",
      "If you use \"Notice when I've moved\": on Android the step counter's readings of about the last 2 hours and the time you last moved; on iPhone the time you last moved. Step counts are not kept in the history.",
      'For the widget and the Lock Screen countdown: the next break time, in storage only the app and its widget can read.',
    ],
    after: ['We never receive any of it. Stats > Delete history, or uninstalling the app, removes it.'],
  },
  {
    heading: 'Permissions, each asked only when you use the feature',
    paragraphs: [],
    bullets: [
      'Notifications: to show reminders. They are scheduled on your phone, not by a server.',
      'Display over other apps (Android, optional): the full-screen break.',
      'Usage Access (Android, optional): Android describes it as access to app usage information. The app only checks which app is in front, about every 2 seconds, to skip counting in apps you chose.',
      'Physical activity (Android) / Motion & Fitness (iPhone) (optional): the step counter, only to skip a move reminder after you walked.',
      'Foreground service and start after a restart (Android): to keep counting with a visible notification, and to start again after a restart or an update.',
    ],
    after: ['The app does not use your location, contacts, photos, camera or microphone.'],
  },
  {
    heading: 'Links',
    paragraphs: ["Study and help links open in your phone's browser when you tap them; that website's own policy applies."],
  },
  {
    heading: 'Files you export',
    paragraphs: ["The CSV export creates a file only when you ask and hands it to your phone's share sheet. We do not see it."],
  },
  {
    heading: 'Backups',
    paragraphs: [
      'The app asks Android not to include its data in your Google backup. On iPhone, iCloud Backup may include it if you have it switched on; Apple does that under your account, and we do not receive it.',
    ],
  },
  {
    heading: 'Sharing, ads, children',
    paragraphs: ['No data is shared. No ads, no analytics, no account, no purchases. The app is not directed at children.'],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      `We receive no personal data, so there is nothing for us to access, correct or delete; removing the app removes its data. Questions: ${PRIVACY_CONTACT}. You may complain to your data protection authority.`,
    ],
  },
  {
    heading: 'Medical note',
    paragraphs: ['Eye Rest & Move is a wellness reminder, not a medical device.'],
  },
  {
    heading: 'Changes',
    paragraphs: ['A changed policy is published on the web page and in the app, with a new date.'],
  },
];
