import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/AccessibilityContext';
import { radius, shadow, spacing, type as typeToken } from '../../theme/tokens';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  /** Show a short, non-blocking message at the bottom of the screen. */
  showToast: (message: string, tone?: ToastTone) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const TONE_ICON: Record<ToastTone, React.ComponentProps<typeof Ionicons>['name']> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hideToast = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      clearTimer();
      setToast({ id: Date.now(), message, tone });
      timer.current = setTimeout(() => setToast(null), 4000);
    },
    [clearTimer]
  );

  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo<ToastContextValue>(() => ({ showToast, hideToast }), [showToast, hideToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toast={toast} onHide={hideToast} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toast, onHide }: { toast: ToastMessage | null; onHide: () => void }) {
  const { colors, textScale, reduceMotion } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: toast ? 1 : 0,
      duration: reduceMotion ? 0 : 220,
      useNativeDriver: true,
    }).start();
  }, [progress, toast, reduceMotion]);

  if (!toast) return null;

  const tones: Record<ToastTone, { bg: string; fg: string }> = {
    success: { bg: colors.successTint, fg: colors.success },
    error: { bg: colors.dangerTint, fg: colors.danger },
    info: { bg: colors.infoTint, fg: colors.info },
  };
  const { bg, fg } = tones[toast.tone];

  return (
    <View pointerEvents="none" style={styles.host}>
      <Animated.View
        style={[
          styles.toast,
          shadow.raised,
          {
            backgroundColor: bg,
            borderColor: fg,
            opacity: progress,
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [reduceMotion ? 0 : 24, 0],
                }),
              },
            ],
          },
        ]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <Ionicons name={TONE_ICON[toast.tone]} size={20} color={fg} />
        <Text style={[typeToken('body', textScale), styles.text, { color: fg }]}>{toast.message}</Text>
      </Animated.View>
    </View>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xxl,
    paddingHorizontal: spacing.screen,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 520,
    width: '100%',
  },
  text: {
    flex: 1,
  },
});
