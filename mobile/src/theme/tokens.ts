// ParkWise mobile design tokens.
//
// The single source of truth for colour, spacing, radius and type across the
// app. Every screen and component reads from here, which is also what makes
// the high-contrast toggle in Settings a real theme switch rather than a
// cosmetic one (see contexts/AccessibilityContext.tsx).

export const palette = {
  // Brand
  navy: '#0F2A4A',
  navyDeep: '#0A1D33',
  navySoft: '#1A3A5F',
  teal: '#14B8A6',
  tealDark: '#0F766E',
  tealTint: '#E6FAF7',

  // Hero band / dark panels. Kept separate from `navy` so that switching to
  // high contrast (where `navy` becomes white ink) can never turn the header
  // into a white bar sitting on a black page.
  heroBg: '#0F2A4A',
  heroText: '#FFFFFF',
  heroMuted: '#E6FAF7',

  // Surfaces
  background: '#F6F8FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F5F9',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',

  // Text
  text: '#0F2A4A',
  textMuted: '#64748B',
  textOnDark: '#FFFFFF',

  // Status (all >= 4.5:1 against their tint / white where used as text)
  success: '#15803D',
  successTint: '#DCFCE7',
  warning: '#B45309',
  warningTint: '#FEF3C7',
  danger: '#B91C1C',
  dangerTint: '#FEE2E2',
  info: '#1D4ED8',
  infoTint: '#DBEAFE',
  neutral: '#475569',
  neutralTint: '#E2E8F0',

  // Floor-plan slot states
  slotAvailable: '#15803D',
  slotAvailableTint: '#DCFCE7',
  slotReserved: '#B45309',
  slotReservedTint: '#FEF3C7',
  slotMine: '#0F766E',
  slotMineTint: '#E6FAF7',
  slotMaintenance: '#C2410C',
  slotMaintenanceTint: '#FFEDD5',
  slotPwdLocked: '#1D4ED8',
  slotPwdLockedTint: '#DBEAFE',

  overlay: 'rgba(15, 42, 74, 0.45)',
  scrim: 'rgba(15, 23, 42, 0.55)',
} as const;

// Widened to `string` so the high-contrast set can swap every value while
// keeping the same key set as the light palette.
export type ThemeColors = { [K in keyof typeof palette]: string };

export const highContrastColors: ThemeColors = {
  ...palette,
  background: '#000000',
  surface: '#0B0B0B',
  surfaceAlt: '#161616',
  border: '#7A7A7A',
  borderStrong: '#FFFFFF',
  text: '#FFFFFF',
  textMuted: '#E5E5E5',
  navy: '#FFFFFF',
  navySoft: '#D4D4D4',
  teal: '#5EEAD4',
  tealDark: '#5EEAD4',
  tealTint: '#0B0B0B',
  heroBg: '#0B0B0B',
  heroText: '#FFFFFF',
  heroMuted: '#E5E5E5',
  textOnDark: '#000000',
  success: '#4ADE80',
  successTint: '#0B0B0B',
  warning: '#FBBF24',
  warningTint: '#0B0B0B',
  danger: '#F87171',
  dangerTint: '#0B0B0B',
  info: '#93C5FD',
  infoTint: '#0B0B0B',
  neutral: '#E5E5E5',
  neutralTint: '#161616',
  slotAvailable: '#4ADE80',
  slotAvailableTint: '#0B0B0B',
  slotReserved: '#FBBF24',
  slotReservedTint: '#0B0B0B',
  slotMine: '#5EEAD4',
  slotMineTint: '#0B0B0B',
  slotMaintenance: '#FB923C',
  slotMaintenanceTint: '#0B0B0B',
  slotPwdLocked: '#93C5FD',
  slotPwdLockedTint: '#0B0B0B',
};

// 4 / 8 / 12 / 16 / 24 / 32 scale
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  /** Standard horizontal screen padding. */
  screen: 20,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/** Minimum touch target, in dp. */
export const TOUCH_TARGET = 48;

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  subtitle: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  // 13 rather than 12 so that even the "Small" text-size setting keeps the
  // smallest style at 12 dp, which stays readable on a phone.
  small: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F2A4A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  raised: {
    shadowColor: '#0F2A4A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },
} as const;

export type TextSize = 'small' | 'medium' | 'large';

/** Multiplier applied to every font size; capped so layouts cannot break. */
export const TEXT_SCALE: Record<TextSize, number> = {
  small: 0.9,
  medium: 1,
  large: 1.2,
};

const FONT_WEIGHT_MAP: Record<string, '400' | '500' | '600' | '700'> = {
  '400': '400',
  '500': '500',
  '600': '600',
  '700': '700',
};

/** Inter, loaded from @expo-google-fonts/inter in App.tsx. */
export const FONTS = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

const FONT_FAMILY: Record<'400' | '500' | '600' | '700', string> = {
  '400': FONTS.regular,
  '500': FONTS.medium,
  '600': FONTS.semibold,
  '700': FONTS.bold,
};

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  fontFamily: string;
}

/**
 * Resolve a type token to a concrete style, honouring the in-app text-size
 * setting. The system font scale still applies on top of this (we never set
 * allowFontScaling={false}).
 */
export function type(token: keyof typeof typography, multiplier = 1, cap = 1.35): TypeStyle {
  const t = typography[token];
  const applied = Math.min(multiplier, cap);
  const fontWeight = FONT_WEIGHT_MAP[String(t.fontWeight)] ?? '400';
  return {
    fontSize: Math.round(t.fontSize * applied),
    lineHeight: Math.round(t.lineHeight * applied),
    fontWeight,
    fontFamily: FONT_FAMILY[fontWeight],
  };
}

export const colors = {
  ...palette,
  // Names used by screens written before the tokens were consolidated. They
  // resolve to real tokens above, so those screens keep rendering correctly
  // while they are migrated onto the new set.
  primary: palette.navy,
  primaryLight: '#E6EEF9',
  textSecondary: palette.textMuted,
  accent: palette.teal,
  error: palette.danger,
};
export const borderRadius = radius;
export const fontSize = {
  xs: typography.small.fontSize,
  sm: typography.caption.fontSize,
  md: typography.body.fontSize,
  lg: typography.subtitle.fontSize,
  xl: typography.title.fontSize,
  xxl: typography.display.fontSize,
} as const;

export type DesignTheme = {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadow: typeof shadow;
  textScale: number;
  reduceMotion: boolean;
};

export const defaultTheme: DesignTheme = {
  colors: palette,
  spacing,
  radius,
  typography,
  shadow,
  textScale: 1,
  reduceMotion: false,
};
