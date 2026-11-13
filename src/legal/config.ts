// Business details used by the privacy policy, terms, support and account deletion pages.
// Every value in [BRACKETS] is a placeholder the owner must fill in before launch
// (see docs/RELEASE_CHECKLIST.md, "Placeholders").
import { WEB_APP_URL } from '@/backend/config';

/**
 * Set to true only after an attorney has reviewed the privacy policy and terms.
 * While false, every legal page shows a "template" banner.
 */
export const LEGAL_REVIEWED = false;

export const COMPANY = {
  /** Brand name of the publisher. */
  name: 'Spott Ventures',
  /** Full legal name and type, for example "Spott Ventures LLC". */
  legalName: '[LEGAL ENTITY NAME AND TYPE]',
  city: 'Birmingham, Alabama',
  mailingAddress: '[COMPANY MAILING ADDRESS]',
  supportEmail: '[SUPPORT EMAIL]',
  /** Typical time to answer a support or privacy request. */
  responseTime: '[SUPPORT RESPONSE TIME, e.g. 2 business days]',
} as const;

export const LEGAL_DATES = {
  privacyEffective: '[EFFECTIVE DATE]',
  termsEffective: '[EFFECTIVE DATE]',
} as const;

export const RETENTION = {
  /** How long a company's data is kept after its subscription ends, before deletion. */
  afterSubscriptionEnds: '[DAYS AFTER CANCELLATION, e.g. 90 days]',
  /** How long deleted items stay recoverable (soft delete) before they are purged. */
  softDeletePurge: '[PURGE PERIOD, e.g. 30 days]',
  /** How long database backups are kept by the hosting provider. */
  backups: '[BACKUP RETENTION, e.g. 7 days]',
  /** Where the database and photos are hosted. */
  hostingRegion: '[HOSTING REGION, e.g. United States (us-east-1)]',
} as const;

/** Public website address (from EXPO_PUBLIC_WEB_APP_URL), shown without "https://". */
export const WEB_HOST = WEB_APP_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '');
export const WEB_BASE = WEB_APP_URL.replace(/\/+$/, '');

/** Public URLs of these pages (the same routes serve the website). */
export const LEGAL_URLS = {
  privacy: `${WEB_BASE}/legal/privacy`,
  terms: `${WEB_BASE}/legal/terms`,
  support: `${WEB_BASE}/support`,
  deleteAccount: `${WEB_BASE}/legal/delete-account`,
} as const;
