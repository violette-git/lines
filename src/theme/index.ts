// Field-first theme: dark surfaces for battery and glare, hi-vis accents readable in sunlight,
// large glove-friendly touch targets.
export const colors = {
  bg: '#0B0F14',
  surface: '#121821',
  surfaceAlt: '#18202B',
  surfaceRaised: '#1F2935',
  border: '#2A3644',
  borderStrong: '#3A4A5C',
  text: '#F2F5F8',
  textMuted: '#A7B3C2',
  textFaint: '#6E7C8D',
  accent: '#FFB020', // hi-vis amber: primary actions, aerial
  accentPressed: '#E59A0E',
  onAccent: '#1A1203',
  cyan: '#3CC8F0', // underground
  success: '#3DDC97',
  warning: '#FFCC4D',
  danger: '#FF5D5D',
  info: '#5AA9FF',
  overlay: 'rgba(5,8,12,0.72)',
  aerial: '#FFB020',
  underground: '#3CC8F0',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** Minimum touch target (glove friendly). */
export const TOUCH = 52;

export const font = {
  // System fonts keep the bundle small and render crisply on both platforms.
  display: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2 },
  heading: { fontSize: 16, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.2 },
  caption: { fontSize: 12, fontWeight: '500' as const },
  mono: { fontSize: 13, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
} as const;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;
