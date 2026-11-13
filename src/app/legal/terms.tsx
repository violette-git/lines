// Terms of use. Public route: also served on the website at /legal/terms.
import { Stack } from 'expo-router';

import { LegalDocView } from '@/legal/LegalDocView';
import { TERMS } from '@/legal/terms';

export default function TermsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Terms of use' }} />
      <LegalDocView doc={TERMS} />
    </>
  );
}
