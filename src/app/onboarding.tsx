// First-run intro: 4 swipeable slides, Skip / Next / Get started, and a demo project shortcut.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { notify } from '@/components/confirm';
import { ExportArt, MapArt, MeasureArt, SnapArt } from '@/components/OnboardingArt';
import { markOnboardingSeen } from '@/components/prefs';
import { Button, T } from '@/components/ui';
import { DEMO_PROJECT_ID } from '@/data';
import { useStore } from '@/state/store';
import { colors, radius, space } from '@/theme';

const SLIDES: { key: string; kicker: string; title: string; body: string; art: ReactNode }[] = [
  {
    key: 'snap',
    kicker: '1  Snap',
    title: 'One photo per pole or handhole',
    body: 'Tap the big shutter button. The app grabs the photo and averages a few seconds of GPS so each node lands in the right spot.',
    art: <SnapArt />,
  },
  {
    key: 'map',
    kicker: '2  Map',
    title: 'Nodes drop on the map as you walk',
    body: 'With walk mode on, every new node connects to the last one. If GPS drifts, drag the node onto the pole in the satellite photo.',
    art: <MapArt />,
  },
  {
    key: 'measure',
    kicker: '3  Measure',
    title: 'Footage adds itself up',
    body: 'Span lengths calculate from the map. Add sag (extra cable for droop) and slack (spare coils), or type in wheel footage to override.',
    art: <MeasureArt />,
  },
  {
    key: 'export',
    kicker: '4  Export',
    title: 'Hand in clean files',
    body: 'Send KMZ for Google Earth, Excel for the office, a PDF report with photos, or GIS files (GeoJSON, Shapefile) for engineering.',
    art: <ExportArt />,
  },
];

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scroller = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const projects = useStore((s) => s.projects);
  const createProject = useStore((s) => s.createProject);
  const last = index === SLIDES.length - 1;
  const compact = height < 560; // landscape phones
  const artScale = compact ? 0.62 : Math.min(1.25, Math.max(0.85, width / 400));

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
    scroller.current?.scrollTo({ x: clamped * width, animated: true });
    setIndex(clamped);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== index) setIndex(i);
  };

  const finish = async () => {
    await markOnboardingSeen();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const demo = projects.find((p) => p.id === DEMO_PROJECT_ID) ?? null;
  const tryDemo = async () => {
    setBusy(true);
    try {
      await markOnboardingSeen();
      const target =
        demo ??
        (await createProject({
          name: 'Sample project',
          client: 'Practice',
          jobNumber: 'SAMPLE',
          workType: 'aerial',
          walkMode: true,
          notes: 'A practice project. Snap a few photos around you to see how nodes and spans work, then delete it.',
        }));
      router.replace(`/project/${target.id}`);
    } catch (err) {
      notify('Could not open the sample', err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + space.md }]}>
      <View style={[styles.top, { paddingLeft: insets.left + space.lg, paddingRight: insets.right + space.lg }]}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="git-network" size={18} color={colors.onAccent} />
          </View>
          <T v="heading">
            LineMap <T v="heading" color={colors.accent}>Pro</T>
          </T>
        </View>
        {!last ? (
          <Pressable onPress={finish} hitSlop={12} accessibilityRole="button" style={styles.skip}>
            <T v="heading" color={colors.textMuted}>
              Skip
            </T>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        // Web has no momentum events; settle the index on every scroll frame instead.
        onScroll={Platform.OS === 'web' ? onScrollEnd : undefined}
        scrollEventThrottle={64}
        style={{ flex: 1 }}
      >
        {SLIDES.map((s) => (
          <View
            key={s.key}
            style={[
              styles.slide,
              { width, paddingLeft: insets.left + space.xl, paddingRight: insets.right + space.xl },
              compact && { flexDirection: 'row', gap: space.xl },
            ]}
          >
            <View style={{ transform: [{ scale: artScale }], marginVertical: compact ? -40 : space.lg }}>{s.art}</View>
            <View style={[styles.copy, compact && { flex: 1, alignItems: 'flex-start' }]}>
              <T v="label" color={colors.accent} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>
                {s.kicker}
              </T>
              <T v="display" style={[styles.title, compact && { textAlign: 'left', fontSize: 22 }]}>
                {s.title}
              </T>
              <T color={colors.textMuted} style={[styles.body, compact && { textAlign: 'left' }]}>
                {s.body}
              </T>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.bottom, { paddingLeft: insets.left + space.lg, paddingRight: insets.right + space.lg }]}>
        <View style={styles.dots} accessibilityLabel={`Slide ${index + 1} of ${SLIDES.length}`}>
          {SLIDES.map((s, i) => (
            <Pressable key={s.key} onPress={() => goTo(i)} hitSlop={10} accessibilityLabel={`Go to slide ${i + 1}`}>
              <View style={[styles.dot, i === index && styles.dotOn]} />
            </Pressable>
          ))}
        </View>
        <View style={[styles.actions, last && { flexDirection: 'column' }]}>
          {last ? (
            <>
              <Button title="Get started" icon="arrow-forward" onPress={finish} />
              <Button
                title={demo ? 'Try the demo project' : 'Create a sample project'}
                kind="secondary"
                icon={demo ? 'map-outline' : 'flask-outline'}
                onPress={tryDemo}
                loading={busy}
              />
            </>
          ) : (
            <>
              <Button title="Back" kind="ghost" onPress={() => goTo(index - 1)} disabled={index === 0} style={{ flex: 1 }} />
              <Button title="Next" icon="arrow-forward" onPress={() => goTo(index + 1)} style={{ flex: 2 }} />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  logo: { width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  skip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  copy: { alignItems: 'center', gap: space.sm, maxWidth: 520 },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', fontSize: 16, lineHeight: 23 },
  bottom: { gap: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong },
  dotOn: { width: 28, backgroundColor: colors.accent },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
