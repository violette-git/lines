// Web links built by the dashboard.
import { WEB_APP_URL } from '@/backend/config';

const base = () => WEB_APP_URL.replace(/\/$/, '');

/** Link an invited person opens to join (the join screen is src/app/org/join.tsx). */
export function inviteLink(token: string): string {
  return `${base()}/org/join?token=${encodeURIComponent(token)}`;
}

/** Copies text in the browser. Returns false when the browser refuses (no permission, not https). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

/**
 * Website path to open for a dashboard path seen inside the phone app. Billing is never linked
 * from the phone app (app store rules on purchase links), so it opens the dashboard home.
 */
export function webPathForNative(path: string): string {
  const p = path.startsWith('/admin') ? path : '/admin';
  if (p.startsWith('/admin/billing')) return '/admin';
  return p;
}
