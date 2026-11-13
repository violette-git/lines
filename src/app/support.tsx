// Support: contact, FAQ, account deletion and legal links. Public route: also served on the
// website at /support (the App Store "Support URL").
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PageScroll } from '@/components/Page';
import { Button, Card, SectionTitle, T } from '@/components/ui';
import { LegalFooter, TemplateBanner } from '@/legal/LegalDocView';
import { SUPPORT_CONTACT, SUPPORT_FAQ, type FaqItem } from '@/legal/support';
import { colors, radius, space, TOUCH } from '@/theme';

export default function SupportScreen() {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  const version = Constants.expoConfig?.version ?? '';

  return (
    <>
      <Stack.Screen options={{ title: 'Support' }} />
      <PageScroll>
        <TemplateBanner />
        <T v="display" style={{ marginTop: space.lg }}>
          How can we help?
        </T>

        <Card style={styles.contact}>
          <View style={styles.contactHead}>
            <View style={styles.icon}>
              <Ionicons name="mail-outline" size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="heading">Contact support</T>
              <T v="caption" color={colors.textMuted}>
                We usually answer within {SUPPORT_CONTACT.responseTime}.
              </T>
            </View>
          </View>
          <Text selectable style={styles.email}>
            {SUPPORT_CONTACT.email}
          </Text>
          <T v="caption" color={colors.textMuted} style={{ lineHeight: 18 }}>
            Include your company name, your phone model and what you were doing. For problems with a project, say which project and node.
          </T>
          <Button title="Open the in-app guide" icon="book-outline" kind="secondary" onPress={() => router.push('/help')} />
        </Card>

        <SectionTitle>Common questions</SectionTitle>
        <View style={{ gap: space.sm }}>
          {SUPPORT_FAQ.map((item, i) => (
            <Faq key={i} item={item} expanded={!!open[i]} onToggle={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} />
          ))}
        </View>

        <SectionTitle>Your account</SectionTitle>
        <Card style={{ gap: space.md }}>
          <View style={styles.contactHead}>
            <View style={[styles.icon, { backgroundColor: colors.danger + '1A' }]}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </View>
            <T v="heading" style={{ flex: 1 }}>
              Delete your account
            </T>
          </View>
          <T color={colors.textMuted} style={{ lineHeight: 22 }}>
            In the app, open Account, then Delete account. You can also delete it on the website or ask us by email. Field data you collected for a company stays with that company.
          </T>
          <Button title="How account deletion works" kind="secondary" icon="information-circle-outline" onPress={() => router.push('/legal/delete-account')} />
        </Card>

        <LegalFooter />
        {version ? (
          <T v="caption" color={colors.textFaint} style={{ marginTop: space.sm }}>
            LineMap Pro version {version}
          </T>
        ) : null}
      </PageScroll>
    </>
  );
}

function Faq({ item, expanded, onToggle }: { item: FaqItem; expanded: boolean; onToggle: () => void }) {
  return (
    <View style={[styles.faq, expanded && { borderColor: colors.borderStrong }]}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }} style={styles.faqHead}>
        <T v="heading" style={{ flex: 1 }}>
          {item.q}
        </T>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={styles.faqBody}>
          {item.a.map((p, i) => (
            <T key={i} color={colors.textMuted} style={{ lineHeight: 22 }}>
              {p}
            </T>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contact: { marginTop: space.lg, gap: space.md },
  contactHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.accent + '1A', alignItems: 'center', justifyContent: 'center' },
  email: { fontSize: 18, fontWeight: '700', color: colors.accent },
  faq: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 4, paddingHorizontal: space.lg, paddingVertical: space.sm },
  faqBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm },
});
