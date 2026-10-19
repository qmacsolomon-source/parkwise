import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DesignTheme,
  TEXT_SCALE,
  TextSize,
  ThemeColors,
  defaultTheme,
  highContrastColors,
  palette,
  radius,
  shadow,
  spacing,
  typography,
} from '../theme/tokens';

const STORAGE_KEY = '@parkwise/accessibility:v1';

interface StoredPreferences {
  textSize: TextSize;
  highContrast: boolean;
  reduceMotion: boolean;
}

const DEFAULT_PREFERENCES: StoredPreferences = {
  textSize: 'medium',
  highContrast: false,
  reduceMotion: false,
};

interface AccessibilityContextValue extends DesignTheme {
  colors: ThemeColors;
  highContrast: boolean;
  textSize: TextSize;
  /** True when the OS "reduce motion" switch is on; combine with the user setting. */
  systemReduceMotion: boolean;
  /** Effective reduce-motion flag: user setting OR system setting. */
  reduceMotion: boolean;
  ready: boolean;
  setTextSize: (size: TextSize) => void;
  setHighContrast: (enabled: boolean) => void;
  setReduceMotion: (enabled: boolean) => void;
  /** Resolved accessibility theme object (compatible with the old defaultTheme). */
  theme: DesignTheme;
}

const AccessibilityContext = createContext<AccessibilityContextValue | undefined>(undefined);

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<StoredPreferences>(DEFAULT_PREFERENCES);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const [ready, setReady] = useState(false);

  // Load persisted preferences once on mount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
          setPreferences({
            textSize: parsed.textSize ?? DEFAULT_PREFERENCES.textSize,
            highContrast: parsed.highContrast ?? DEFAULT_PREFERENCES.highContrast,
            reduceMotion: parsed.reduceMotion ?? DEFAULT_PREFERENCES.reduceMotion,
          });
        }
      } catch (error) {
        console.warn('[accessibility] could not read preferences:', error);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Track the OS-level reduce-motion setting.
  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setSystemReduceMotion(enabled);
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setSystemReduceMotion(enabled)
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const persist = useCallback((next: StoredPreferences) => {
    setPreferences(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((error) =>
      console.warn('[accessibility] could not save preferences:', error)
    );
  }, []);

  const setTextSize = useCallback(
    (textSize: TextSize) => persist({ ...preferences, textSize }),
    [persist, preferences]
  );

  const setHighContrast = useCallback(
    (highContrast: boolean) => persist({ ...preferences, highContrast }),
    [persist, preferences]
  );

  const setReduceMotion = useCallback(
    (reduceMotion: boolean) => persist({ ...preferences, reduceMotion }),
    [persist, preferences]
  );

  const value = useMemo<AccessibilityContextValue>(() => {
    const colors = preferences.highContrast ? highContrastColors : palette;
    const reduceMotion = preferences.reduceMotion || systemReduceMotion;
    const textScale = TEXT_SCALE[preferences.textSize];

    const theme: DesignTheme = {
      ...defaultTheme,
      colors,
      textScale,
      reduceMotion,
    };

    return {
      ...defaultTheme,
      colors,
      spacing,
      radius,
      typography,
      shadow,
      textScale,
      reduceMotion,
      highContrast: preferences.highContrast,
      textSize: preferences.textSize,
      systemReduceMotion,
      ready,
      setTextSize,
      setHighContrast,
      setReduceMotion,
      theme,
    };
  }, [
    preferences,
    systemReduceMotion,
    ready,
    setTextSize,
    setHighContrast,
    setReduceMotion,
  ]);

  return (
    <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>
  );
}

export function useTheme(): AccessibilityContextValue {
  const context = useContext(AccessibilityContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within an AccessibilityProvider');
  }
  return context;
}

export function useAccessibility(): AccessibilityContextValue {
  return useTheme();
}
