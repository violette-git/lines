// Public account deletion instructions (Google Play "Delete account URL").
// Signed-in users get a button to the in-app deletion screen.
import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/components/ui';
import { LegalDocView } from '@/legal/LegalDocView';
import { DELETE_ACCOUNT } from '@/legal/support';
import { space } from '@/theme';

export default function DeleteAccountInfoScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Delete account' }} />
      <LegalDocView doc={DELETE_ACCOUNT}>
        <View style={{ marginTop: space.lg }}>
          <Button title="Go to Account" icon="person-circle-outline" kind="secondary" onPress={() => router.push('/account')} />
        </View>
      </LegalDocView>
    </>
  );
}
