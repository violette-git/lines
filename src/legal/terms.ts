// LineMap Pro terms of use. TEMPLATE: must be reviewed by an attorney before launch.
// These terms cover individual users of the app and website. A customer company's subscription
// is also governed by the order or subscription terms it accepts on the website.
import { COMPANY, LEGAL_DATES, LEGAL_URLS, WEB_HOST } from './config';
import type { LegalDocument } from './types';

export const TERMS: LegalDocument = {
  title: 'Terms of use',
  effective: `Effective ${LEGAL_DATES.termsEffective}`,
  summary: [
    'LineMap Pro is a mapping tool for field crews. Use it lawfully, and only photograph places you are allowed to be.',
    'Safety comes first. Never use the app while driving, climbing or working on energized equipment.',
    'Footage, positions and AI suggestions are estimates. Check them before you design, bill or build from them.',
    'Your company owns the field data you collect for it. Subscriptions are bought by companies on our website, not in the app.',
  ],
  sections: [
    {
      id: 'agreement',
      title: '1. Agreement',
      blocks: [
        {
          k: 'p',
          t: `These terms are an agreement between you and ${COMPANY.name} (${COMPANY.legalName}) ("we", "us") for the LineMap Pro app and website (${WEB_HOST}) (together, the "service"). By creating an account or using the service, you agree to these terms and to our privacy policy (${LEGAL_URLS.privacy}). If you do not agree, do not use the service.`,
        },
        {
          k: 'p',
          t: 'If you use LineMap Pro for a company (your employer or a client), that company\'s subscription agreement with us also applies, and the company is responsible for how its users use the service. If these terms and a signed agreement with your company conflict, the signed agreement wins for that company.',
        },
      ],
    },
    {
      id: 'accounts',
      title: '2. Accounts',
      blocks: [
        {
          k: 'ul',
          items: [
            'You must be at least 18 and able to enter a binding contract.',
            'Give accurate information and keep your password private. You are responsible for activity under your account. Tell us right away if you think someone else is using it.',
            'Company owners and admins control who joins their company, each member\'s role, and can remove members at any time.',
          ],
        },
      ],
    },
    {
      id: 'subscriptions',
      title: '3. Subscriptions and billing',
      blocks: [
        {
          k: 'ul',
          items: [
            'LineMap Pro is sold to companies. A company owner or admin buys and manages the subscription on our website. There are no purchases inside the app.',
            'Plans include a number of user seats and a monthly allowance of AI photo analyses. When the allowance is used up, AI analysis pauses until the next month or an upgrade; the rest of the app keeps working.',
            'Prices, billing periods, renewals, cancellations and refunds are shown on the website at checkout and in the company\'s subscription terms. Payments are processed by Stripe.',
            'If a subscription ends or a payment fails, features that need our servers (sync, AI and the web dashboard) may stop. Data already on your device stays there.',
          ],
        },
      ],
    },
    {
      id: 'safety',
      title: '4. Field safety',
      blocks: [
        {
          k: 'note',
          t: 'Do not use LineMap Pro while driving or operating equipment, while climbing, in a bucket truck, inside a manhole or vault, or near energized lines. Follow your employer\'s safety rules, OSHA rules and the owner\'s requirements at all times. No photo or measurement is worth an injury.',
        },
        {
          k: 'p',
          t: 'The app does not tell you whether a site, structure or line is safe to approach or work on. You and your employer are solely responsible for site safety, traffic control, permissions to enter property, and locating utilities before any digging (call 811 in the United States).',
        },
      ],
    },
    {
      id: 'accuracy',
      title: '5. Measurements, positions and AI are estimates',
      blocks: [
        {
          k: 'ul',
          items: [
            'GPS positions depend on your device, receiver, sky view and surroundings, and can be off by several feet or more. Footage is calculated from those positions plus the sag and slack settings you choose.',
            'AI auto-fill suggestions (such as pole tags, heights, sizes and attachment counts) can be wrong. Heights and sizes are estimates. Review every value before you use it.',
            'LineMap Pro is not a licensed survey, engineering or make-ready design tool. Do not rely on it alone for engineering, permits, billing disputes or safety decisions. Verify critical values in the field.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: '6. Acceptable use',
      blocks: [
        { k: 'p', t: 'You agree not to:' },
        {
          k: 'ul',
          items: [
            'Enter private property, restricted areas or facilities without permission, or photograph people in a way that invades their privacy.',
            'Upload anything illegal, or content you do not have the right to use.',
            'Use the service to track or monitor a person, or for any purpose other than documenting and mapping infrastructure.',
            'Try to access another company\'s data, get around plan limits, share an account, or break or overload the service.',
            'Copy, resell or reverse engineer the app, except where the law allows it.',
            'Use AI features to create harmful content or in a way that breaks Anthropic\'s usage policies.',
          ],
        },
      ],
    },
    {
      id: 'data',
      title: '7. Your content and your company\'s data',
      blocks: [
        {
          k: 'ul',
          items: [
            'Field data you collect for a company (photos, locations, labels, notes and measurements) belongs to that company. If you collect data for yourself, it belongs to you.',
            'You give us permission to store, process, transmit and display that data only as needed to provide the service, including sending photos you choose to analyze to our AI provider.',
            'We do not sell your data and do not use your field data or photos to train AI models.',
            'Our privacy policy explains how we handle personal information.',
          ],
        },
      ],
    },
    {
      id: 'ours',
      title: '8. Our app and license',
      blocks: [
        {
          k: 'p',
          t: 'We own the LineMap Pro app, website, design and software. While you follow these terms, we give you a personal, non-exclusive, non-transferable right to use the app on devices you own or control, for your own work or your company\'s work. Ideas and feedback you send us may be used without any obligation to you.',
        },
      ],
    },
    {
      id: 'thirdparty',
      title: '9. Other services',
      blocks: [
        {
          k: 'p',
          t: 'The service uses other companies\' services, such as map imagery, speech recognition from Apple or Google, AI from Anthropic, hosting from Supabase and payments from Stripe. Their terms may also apply. Map imagery may be out of date or misaligned; use the align and recalibrate tools and your own judgment.',
        },
      ],
    },
    {
      id: 'stores',
      title: '10. App Store and Google Play',
      blocks: [
        {
          k: 'ul',
          items: [
            'If you downloaded the app from Apple\'s App Store: these terms are between you and us, not Apple. Apple is not responsible for the app or its content, has no duty to provide maintenance or support, and is not responsible for any claims about the app (including product liability, legal or regulatory compliance, or intellectual property claims). If the app fails to meet any applicable warranty, you may notify Apple and Apple will refund the purchase price, if any; Apple has no other warranty obligation. You must also follow Apple\'s Usage Rules. Apple and its subsidiaries are third-party beneficiaries of these terms and may enforce them against you.',
            'You confirm you are not located in a country subject to a United States government embargo and are not on a United States government list of prohibited or restricted parties.',
            'If you downloaded the app from Google Play, Google Play\'s terms also apply to the download.',
          ],
        },
      ],
    },
    {
      id: 'disclaimers',
      title: '11. Disclaimers',
      blocks: [
        {
          k: 'p',
          t: 'To the extent the law allows, the service is provided "as is" and "as available", without warranties of any kind, including warranties of merchantability, fitness for a particular purpose, accuracy and non-infringement. We do not promise that the service will be uninterrupted, error free, or that data will never be lost. Keep your own exports of important work.',
        },
      ],
    },
    {
      id: 'liability',
      title: '12. Limits on liability',
      blocks: [
        {
          k: 'p',
          t: 'To the extent the law allows, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data or business, arising from the service. Our total liability for any claim about the service is limited to the greater of the amount paid for the service in the 12 months before the claim, or 100 US dollars. Some places do not allow these limits, so they may not apply to you.',
        },
      ],
    },
    {
      id: 'ending',
      title: '13. Ending your use',
      blocks: [
        {
          k: 'p',
          t: `You can stop using the service and delete your account at any time (see ${LEGAL_URLS.deleteAccount}). We may suspend or end access if you break these terms, if your company asks us to, or if we must for legal or security reasons. Sections that by their nature should continue (such as ownership, disclaimers and limits on liability) continue after your access ends.`,
        },
      ],
    },
    {
      id: 'law',
      title: '14. Governing law',
      blocks: [
        {
          k: 'p',
          t: 'These terms are governed by the laws of the State of Alabama, United States, without regard to its conflict of laws rules. Disputes will be handled in the state or federal courts located in Jefferson County, Alabama, unless the law where you live requires otherwise.',
        },
      ],
    },
    {
      id: 'changes',
      title: '15. Changes',
      blocks: [
        {
          k: 'p',
          t: 'We may update these terms. We will change the effective date above and, for significant changes, tell you in the app or by email before they take effect. Continuing to use the service after that means you accept the new terms.',
        },
      ],
    },
    {
      id: 'contact',
      title: '16. Contact',
      blocks: [
        {
          k: 'p',
          t: `${COMPANY.name} (${COMPANY.legalName}), ${COMPANY.mailingAddress}. Email: ${COMPANY.supportEmail}. Support: ${LEGAL_URLS.support}.`,
        },
      ],
    },
  ],
};
