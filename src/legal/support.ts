// Support FAQ and the public account deletion page (Google Play requires a web page that explains
// how to delete an account and its data, naming the app and the developer).
import { COMPANY, LEGAL_URLS, RETENTION, WEB_HOST } from './config';
import type { LegalDocument } from './types';

export interface FaqItem {
  q: string;
  a: string[];
}

export const SUPPORT_FAQ: FaqItem[] = [
  {
    q: 'How do I get access for my crew?',
    a: [
      'Your company admin sets up the company account and invites each crew member by email.',
      'Each person opens the invitation link on their phone, signs in or creates an account, and joins the company with the role the admin chose.',
    ],
  },
  {
    q: 'Can I buy or change a subscription in the app?',
    a: [
      'No. LineMap Pro is set up for companies by their administrators, and the app has no purchases. Ask your company admin about seats or AI limits.',
    ],
  },
  {
    q: 'Does it work without a signal?',
    a: [
      'Yes. Everything is saved on the phone first. Photos, nodes and spans sync to your company when you are back online. AI auto-fill and satellite imagery need a connection unless you downloaded the area for offline use.',
    ],
  },
  {
    q: 'My GPS position is jumping around. What can I do?',
    a: [
      'Wait for the accuracy chip to turn green, hold still during the short averaging hold, and choose a longer hold in Settings for tree cover or downtown areas.',
      'Use Recalibrate on the map to shift a group of nodes onto the imagery, or connect an external GNSS receiver for survey-grade positions.',
    ],
  },
  {
    q: 'How accurate is AI auto-fill?',
    a: [
      'It reads tags, lid castings and labels well when the photo is sharp and close. Heights and sizes are estimates and show a confidence level. Always review the values before export.',
    ],
  },
  {
    q: 'I turned off camera, location or microphone. How do I turn it back on?',
    a: [
      'iPhone and iPad: Settings, then LineMap Pro, then turn on Camera, Location (While Using the App, with Precise Location on), Microphone or Speech Recognition.',
      'Android: Settings, then Apps, then LineMap Pro, then Permissions.',
    ],
  },
  {
    q: 'Who owns the photos and data I collect?',
    a: [
      'The company you collect it for. Admins can export everything as KMZ, Excel, CSV, PDF, GeoJSON or Shapefile at any time. See the privacy policy for details.',
    ],
  },
  {
    q: 'How do I delete my account?',
    a: [
      `In the app: Account, then Delete account. On the web: sign in at ${WEB_HOST} and use Account, then Delete account. Full details are on the account deletion page.`,
    ],
  },
];

export const SUPPORT_CONTACT = {
  email: COMPANY.supportEmail,
  responseTime: COMPANY.responseTime,
};

export const DELETE_ACCOUNT: LegalDocument = {
  title: 'Delete your LineMap Pro account',
  effective: `LineMap Pro by ${COMPANY.name}`,
  summary: [
    'You can delete your LineMap Pro account at any time, from the app, from the website, or by email.',
    'Deleting your account removes your sign-in and profile and takes you out of every company you belong to.',
  ],
  sections: [
    {
      id: 'app',
      title: 'Delete in the app',
      blocks: [
        {
          k: 'steps',
          items: [
            'Open LineMap Pro and make sure you are signed in.',
            'Open Account.',
            'Tap Delete account, read what will happen, and confirm.',
          ],
        },
      ],
    },
    {
      id: 'web',
      title: 'Delete on the web',
      blocks: [
        {
          k: 'steps',
          items: [
            `Go to ${WEB_HOST} and sign in with the same email and password.`,
            'Open Account.',
            'Choose Delete account and confirm.',
          ],
        },
      ],
    },
    {
      id: 'email',
      title: 'Ask us by email',
      blocks: [
        {
          k: 'p',
          t: `If you cannot sign in, email ${COMPANY.supportEmail} from the email address on your account with the subject "Delete my LineMap Pro account". We may ask you to confirm it is you. We will finish the request within 30 days and let you know when it is done.`,
        },
      ],
    },
    {
      id: 'what',
      title: 'What is deleted and what is kept',
      blocks: [
        {
          k: 'ul',
          items: [
            'Deleted right away: your sign-in (email and password), your name and profile, and your membership in every company.',
            'Removed from this device: your session. Uninstall the app to remove any projects stored only on the phone.',
            'Kept by your company: field data you collected for a company (photos, locations, labels, notes and measurements) belongs to that company and stays in its workspace. Your company can delete it; contact your company admin.',
            'If you are the only member of a company, you can choose to delete that company and all of its data together with your account.',
            `Kept for legal reasons: billing and tax records, and AI usage records needed for billing, for as long as the law requires. Hosting backups are overwritten on a rolling schedule (${RETENTION.backups}).`,
          ],
        },
      ],
    },
    {
      id: 'blocked',
      title: 'If deletion is blocked',
      blocks: [
        {
          k: 'ul',
          items: [
            'You are the only owner of a company that has other members: make another member an owner first, then delete your account.',
            'A company you own still has an active subscription: cancel it on the website first, so nobody keeps being billed.',
          ],
        },
        { k: 'p', t: `Privacy policy: ${LEGAL_URLS.privacy}` },
      ],
    },
  ],
};
