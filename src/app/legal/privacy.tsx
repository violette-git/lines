// Privacy policy. Public route: also served on the website at /legal/privacy (App Store and
// Google Play both need this URL).
import { Stack } from 'expo-router';

import { LegalDocView } from '@/legal/LegalDocView';
import { PRIVACY_POLICY } from '@/legal/privacy';

export default function PrivacyScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Privacy policy' }} />
      <LegalDocView doc={PRIVACY_POLICY} />
    </>
  );
}
