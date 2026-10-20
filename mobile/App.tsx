import React, { useEffect, useState } from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { AccessibilityProvider, useTheme } from './src/contexts/AccessibilityContext';
import { ToastProvider } from './src/components/ui';
import LoginScreen from './src/screens/LoginScreen';
import RegistrationScreen from './src/screens/RegistrationScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import ReservationScreen from './src/screens/ReservationScreen';
import TimerScreen from './src/screens/TimerScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import MyVehiclesScreen from './src/screens/MyVehiclesScreen';
import HelpScreen from './src/screens/HelpScreen';
import WayfindingScreen from './src/screens/WayfindingScreen';

const Stack = createNativeStackNavigator();

/** A phone is ~430 dp wide; browser previews are pinned to that. */
const PHONE_MAX_WIDTH = 430;

console.log('[startup] App module evaluated');

function AppRoutes() {
  const { user, profile, loading } = useAuth();

  console.log('[startup] navigator rendered', {
    loading,
    signedIn: !!user,
    role: profile?.role ?? null,
  });

  if (loading) {
    // Never render nothing: a blank screen is indistinguishable from a crash.
    return (
      <View style={styles.container}>
        <Text style={styles.title}>ParkWise</Text>
        <Text style={styles.message}>Starting up…</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <Stack.Navigator key="auth" initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Registration" component={RegistrationScreen} />
      </Stack.Navigator>
    );
  }

  // Role-based routing
  if (profile?.role === 'attendant' || profile?.role === 'admin') {
    return (
      <Stack.Navigator key="access-denied" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="AccessDenied" component={AccessDeniedScreen} />
      </Stack.Navigator>
    );
  }

  // A customer who checked "I have a PWD permit" at sign-up but hasn't
  // submitted a permit number yet is sent straight to Settings (with the PWD
  // sheet already open) instead of Dashboard, so they finish verification
  // before using the rest of the app. Once they submit a number this stops
  // being true, even while staff verification is still pending.
  const needsPwdSetup = !!profile?.pwd_intent && !profile?.pwd_permit_number;

  return (
    // initialRouteName only applies when a navigator first mounts - without a
    // key that changes here, React treats this as the SAME navigator
    // instance across the login transition (same type, same tree position)
    // and never re-applies it, always landing on the first declared screen
    // instead. The key forces a fresh mount whenever this flips.
    <Stack.Navigator
      key={needsPwdSetup ? 'customer-pwd-setup' : 'customer'}
      initialRouteName={needsPwdSetup ? 'Settings' : 'Dashboard'}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="Reservation" component={ReservationScreen} />
      <Stack.Screen name="Timer" component={TimerScreen} />
      <Stack.Screen name="Wayfinding" component={WayfindingScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        initialParams={needsPwdSetup ? { autoOpenPwd: true } : undefined}
      />
      <Stack.Screen name="MyVehicles" component={MyVehiclesScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
    </Stack.Navigator>
  );
}

function AccessDeniedScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Access Denied</Text>
      <Text style={styles.message}>
        Attendants and admins should use the desktop console, not this mobile app.
      </Text>
    </View>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[startup] render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

/** How long the app waits for the bundled Inter files before giving up. */
const FONT_TIMEOUT_MS = 4000;

/**
 * On the web the whole app is a phone-width column in the middle of the
 * browser window, so a preview looks like the phone build. On device it is a
 * pass-through and changes nothing.
 */
function AppFrame({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();

  if (Platform.OS !== 'web') return <>{children}</>;

  return (
    <View style={[styles.webOuter, { backgroundColor: colors.navyDeep }]}>
      <View style={[styles.webInner, { backgroundColor: colors.background }]}>{children}</View>
    </View>
  );
}

export default function App() {
  console.log('[startup] app mounted');

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // The font files are bundled in the app, so this is local and fast -- but a
  // missing font must never be able to hold the app on the startup screen.
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFontTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const fontsReady = fontsLoaded || !!fontError || fontTimedOut;

  if (!fontsReady) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>ParkWise</Text>
        <Text style={styles.message}>Starting up…</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <AccessibilityProvider>
        <ToastProvider>
          <AppFrame>
            <NavigationContainer>
              <AuthProvider>
                <AppRoutes />
                <StatusBar style="auto" />
              </AuthProvider>
            </NavigationContainer>
          </AppFrame>
        </ToastProvider>
      </AccessibilityProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F8FB',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F2A4A',
    marginBottom: 16,
  },
  message: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
  },
  webOuter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webInner: {
    flex: 1,
    width: '100%',
    maxWidth: PHONE_MAX_WIDTH,
  },
});
