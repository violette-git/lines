// LineMap Pro privacy policy. TEMPLATE: must be reviewed by an attorney before launch.
// Keep this in step with docs/store/APP_PRIVACY.md (App Store and Google Play answers) and with
// ios.privacyManifests in app.json. If the app starts collecting something new (analytics, crash
// reports, background location), update all three.
import { COMPANY, LEGAL_DATES, LEGAL_URLS, RETENTION, WEB_HOST } from './config';
import type { LegalDocument } from './types';

export const PRIVACY_POLICY: LegalDocument = {
  title: 'Privacy policy',
  effective: `Effective ${LEGAL_DATES.privacyEffective}`,
  summary: [
    'LineMap Pro is a work tool. Crews use it to photograph and map cable and fiber plant for the company they work for.',
    'The field data (photos, locations, labels, measurements) belongs to that company. We store and process it for them.',
    'We use your precise location only while the app is open, to place what you photograph. We do not track you in the background.',
    'When AI auto-fill is on, the photo you choose to analyze is sent to Anthropic (the maker of Claude) to read tags and fill in fields.',
    'No ads. No selling or renting of personal data. No tracking across other apps or websites.',
    `You can delete your account in the app (Account, then Delete account) or on the web at ${LEGAL_URLS.deleteAccount}.`,
  ],
  sections: [
    {
      id: 'who',
      title: '1. Who we are',
      blocks: [
        {
          k: 'p',
          t: `LineMap Pro (the "app") is published by ${COMPANY.name} (${COMPANY.legalName}), based in ${COMPANY.city} ("${COMPANY.name}", "we", "us"). This policy explains what information the app and the LineMap Pro website (${WEB_HOST}) collect, why, who we share it with, and the choices you have.`,
        },
        {
          k: 'p',
          t: `We sell LineMap Pro to companies (for example contractors, engineering firms and network operators). In this policy, the company that has a LineMap Pro subscription is the "customer" and the people who use the app for that company are "users".`,
        },
      ],
    },
    {
      id: 'roles',
      title: '2. Whose data it is',
      blocks: [
        {
          k: 'p',
          t: 'Field data is the information users collect for their company: photos of poles, handholes, vaults, pedestals and other equipment, the GPS position of each node, labels, notes, measurements, span footage, templates, rates and exports.',
        },
        {
          k: 'ul',
          items: [
            'The customer company owns its field data and decides how it is used. For field data we act as a service provider (also called a "processor") and handle it only to run the service for that customer, following its instructions and our agreement with it.',
            'For account details (your name, email and sign-in), website use and billing records, we decide how the data is used and this policy applies directly.',
            'If you use LineMap Pro for your employer and have a question about field data, such as a request to see or remove photos you took, please contact your employer first. We will help them answer it.',
          ],
        },
      ],
    },
    {
      id: 'collect',
      title: '3. What we collect',
      blocks: [
        { k: 'p', t: 'Account and company details' },
        {
          k: 'ul',
          items: [
            'Your name, email address and password. Passwords are handled by our sign-in provider and stored only in a scrambled (hashed) form we cannot read.',
            'The companies you belong to, your role in each (owner, admin, manager, tech or viewer) and invitations you send or accept.',
          ],
        },
        { k: 'p', t: 'Field data you create' },
        {
          k: 'ul',
          items: [
            'Photos you take or import. Photos are meant to show equipment, but they can also capture people, vehicles, house numbers or private property in the background. Please frame photos on the equipment.',
            'If you turn on the photo stamp, the GPS position and time are printed onto a copy of the photo.',
            'Labels, notes, attributes, measurements, span types and footage, project names, client templates and rates you enter.',
            'Who created or changed each item and when (an activity log), so your company can review changes.',
          ],
        },
        { k: 'p', t: 'Location' },
        {
          k: 'ul',
          items: [
            'Precise GPS location, only while the app is open and you are capturing, placing or recalibrating nodes. The position, its accuracy and the time are saved with each node and photo.',
            'Because each node records where and when it was captured, your company can see where its crews collected data. LineMap Pro does not collect your location in the background or when the app is closed, and it does not keep a continuous track of where you go.',
            'If you connect an external GPS or GNSS receiver over Wi-Fi, the app reads positions from that receiver in the same way.',
            'Photos you import may contain the location stored by your camera. The app reads it only to place that photo.',
          ],
        },
        { k: 'p', t: 'Voice input (optional)' },
        {
          k: 'ul',
          items: [
            'When you tap a microphone button, the app uses your phone\'s built-in speech recognition (Apple on iPhone and iPad, Google on Android) to turn your words into text. Apple or Google may process that audio on the device or on their servers under their own privacy policies.',
            'We receive only the resulting text, which you can edit. We do not record or store the audio.',
          ],
        },
        { k: 'p', t: 'AI usage and service records' },
        {
          k: 'ul',
          items: [
            'For each AI photo analysis: which company and user asked, when, the AI model used, the amount of processing used and an estimated cost. This is how we enforce monthly plan limits and bill fairly.',
            'Technical logs kept by our hosting providers for security and troubleshooting, such as IP address, time and the address of the request.',
          ],
        },
        { k: 'p', t: 'Billing (website only)' },
        {
          k: 'ul',
          items: [
            'Subscriptions are bought on our website by a company owner or admin, not in the app. Payments are processed by Stripe. We do not receive or store full card numbers.',
            'We keep the plan, seat count, subscription status and the Stripe customer and subscription identifiers for each company.',
          ],
        },
        { k: 'p', t: 'What we do not collect' },
        {
          k: 'ul',
          items: [
            'No advertising identifiers, no ad networks and no advertising or marketing trackers.',
            'No contacts, calendars, messages, health data or browsing history.',
            'No analytics or crash-reporting kits from third parties are built into the app at this time. If that changes, we will update this policy first.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: '4. How we use it',
      blocks: [
        {
          k: 'ul',
          items: [
            'To run the app: save your work, place nodes on the map, calculate footage, build exports and keep your crew in sync.',
            'To sign you in, keep accounts secure and let company admins manage members and roles.',
            'To provide AI auto-fill when your company has it turned on (see section 5).',
            'To enforce plan limits, bill subscriptions on the website and prevent abuse.',
            'To answer support requests and send service messages such as invitations, password resets and important changes. We do not send marketing email from the app.',
            'To meet legal obligations and protect the rights and safety of users, customers and the public.',
          ],
        },
        {
          k: 'p',
          t: 'We do not sell personal information, we do not share it for targeted advertising, and we do not use field data or photos to train AI models.',
        },
      ],
    },
    {
      id: 'ai',
      title: '5. AI auto-fill and Anthropic',
      blocks: [
        {
          k: 'p',
          t: 'AI auto-fill reads pole tags, lid castings and equipment labels in a photo, counts attachments and suggests values for the node\'s fields. Heights and sizes are estimates and are marked with a confidence level. Always check AI suggestions before you rely on them.',
        },
        {
          k: 'ul',
          items: [
            'It runs only when AI is turned on and a photo is analyzed. Your company can turn AI off.',
            'In company mode, the app sends the photo, the node type, the list of fields to fill and short project context (the type of work, the client name and the label of the previous node) to our server. Our server checks your account and plan, then sends that content to Anthropic, PBC, which provides the Claude AI model, and returns the suggestions to the app.',
            'Anthropic processes this content as our service provider. Under Anthropic\'s commercial terms for its API, Anthropic does not use this content to train its models, and it keeps it only for a limited time for safety and legal reasons as described in its own policies.',
            'A testing mode lets a person enter their own Anthropic API key on the phone. In that mode, photos go directly from the phone to Anthropic under that key owner\'s account and terms, not through our server. This mode is for testing only.',
          ],
        },
      ],
    },
    {
      id: 'share',
      title: '6. Who we share it with',
      blocks: [
        {
          k: 'p',
          t: 'We share information only as needed to run LineMap Pro, with these kinds of recipients:',
        },
        {
          k: 'ul',
          items: [
            'Your company. Members of the same company can see its projects, nodes, photos and templates according to their role. Owners and admins can see members, AI usage and the activity log.',
            `Supabase, which hosts our database, sign-in, photo storage and server functions (${RETENTION.hostingRegion}).`,
            'Anthropic, for AI photo analysis (section 5).',
            'Stripe, for subscription billing on the website.',
            'Email delivery providers, to send sign-in, invitation and password reset email.',
            'Map providers, which supply satellite imagery and street maps. To show map tiles, the app asks these providers for the area on screen, which reveals your IP address and the general area you are viewing.',
            'Apple and Google, which distribute the app and provide speech recognition when you use voice input.',
            'Anyone you choose to send an export to. KMZ, Excel, CSV, PDF, GeoJSON and Shapefile exports go wherever you share them, and include the photos and locations they contain.',
            'Authorities or others when the law requires it, to protect rights and safety, or as part of a merger or sale of the business (in which case this policy will continue to apply to your information).',
          ],
        },
        {
          k: 'p',
          t: 'Our service providers may use the information only to provide their service to us and must protect it.',
        },
      ],
    },
    {
      id: 'device',
      title: '7. Data on your device',
      blocks: [
        {
          k: 'p',
          t: 'LineMap Pro saves your work on your device first, so it works without a signal. Projects, nodes and photos stay in the app\'s private storage on the device until they sync to your company\'s workspace. Uninstalling the app removes this local copy, including anything that has not synced yet. If you sign out on a shared device, unsynced work may be lost, so sync first.',
        },
      ],
    },
    {
      id: 'retention',
      title: '8. How long we keep it',
      blocks: [
        {
          k: 'ul',
          items: [
            'Account details: for as long as your account exists. When you delete your account, your sign-in and profile are removed.',
            'Field data: for as long as the customer company keeps its workspace, or until it deletes the data. Items deleted in the app are kept for a short recovery period, then permanently removed (' + RETENTION.softDeletePurge + ').',
            `After a company's subscription ends, we keep its workspace for ${RETENTION.afterSubscriptionEnds} so it can export its data or renew, then delete it.`,
            `Backups made by our hosting provider are overwritten on a rolling schedule (${RETENTION.backups}).`,
            'AI usage and billing records: as long as needed for billing, tax and legal purposes.',
          ],
        },
      ],
    },
    {
      id: 'delete',
      title: '9. Deleting your account',
      blocks: [
        {
          k: 'steps',
          items: [
            'In the app: open Account, then Delete account, and confirm.',
            `On the web: sign in at ${WEB_HOST} and open Account, then Delete account. Instructions are also at ${LEGAL_URLS.deleteAccount}.`,
            `By email: write to ${COMPANY.supportEmail} from the email address on your account and ask us to delete it.`,
          ],
        },
        {
          k: 'p',
          t: 'When you delete your account you leave every company you belong to. Field data you collected for a company stays with that company, because it belongs to them. If you are the only member of a company, you can choose to delete that company and all of its data along with your account. If you are the only owner of a company that still has other members or an active subscription, you will be asked to hand over ownership or cancel the subscription first.',
        },
      ],
    },
    {
      id: 'security',
      title: '10. Security',
      blocks: [
        {
          k: 'p',
          t: 'Data is encrypted in transit (HTTPS). Each company\'s data is separated by database rules checked on every request, photos are kept in private storage, and secret keys for AI and billing stay on our servers, never in the app. No system is perfectly secure; if we learn of a breach that affects you, we will notify you and your company as the law requires.',
        },
      ],
    },
    {
      id: 'rights',
      title: '11. Your choices and rights',
      blocks: [
        {
          k: 'ul',
          items: [
            'Permissions: you can turn camera, location, microphone, speech recognition and photo access on or off at any time in your device settings. Some features will not work without them.',
            'Access, correction, export and deletion: you can see your account details in the app, and your company can export its project data at any time. You can ask us for a copy of your personal information, to correct it or to delete it.',
            'Depending on where you live (for example California, other US states, the European Economic Area or the United Kingdom), you may have additional rights, such as to object to or limit certain processing, and to complain to a data protection authority. We will not treat you differently for using these rights.',
            `To make a request, email ${COMPANY.supportEmail}. We may need to confirm your identity. Requests about a company's field data will be passed to that company.`,
          ],
        },
      ],
    },
    {
      id: 'children',
      title: '12. Children',
      blocks: [
        {
          k: 'p',
          t: 'LineMap Pro is a business tool for adults at work. It is not directed to children, and we do not knowingly collect information from anyone under 18. If you believe a child has given us information, contact us and we will delete it.',
        },
      ],
    },
    {
      id: 'transfers',
      title: '13. Where data is processed',
      blocks: [
        {
          k: 'p',
          t: `We host data in ${RETENTION.hostingRegion}. Our service providers may process it in the United States and other countries. Where the law requires it, we use appropriate safeguards for these transfers.`,
        },
      ],
    },
    {
      id: 'changes',
      title: '14. Changes to this policy',
      blocks: [
        {
          k: 'p',
          t: 'If we change this policy, we will update the effective date above. If a change is significant, we will tell you in the app or by email before it takes effect.',
        },
      ],
    },
    {
      id: 'contact',
      title: '15. Contact',
      blocks: [
        {
          k: 'p',
          t: `${COMPANY.name} (${COMPANY.legalName}), ${COMPANY.mailingAddress}. Email: ${COMPANY.supportEmail}.`,
        },
      ],
    },
  ],
};
