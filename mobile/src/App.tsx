import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginScreen from './screens/LoginScreen';
import RegistrationScreen from './screens/RegistrationScreen';
import DashboardScreen from './screens/DashboardScreen';
import ReservationScreen from './screens/ReservationScreen';
import { SlotStatus, ReservationStatus } from '@parkwise/shared';

const Stack = createNativeStackNavigator();

function AppRoutes() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return null; // Or a loading screen
  }

  if (!user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }

  // Role-based routing
  if (profile?.role === 'attendant' || profile?.role === 'admin') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="AccessDenied" component={AccessDeniedScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="Reservation" component={ReservationScreen} />
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

export default function App() {
  return (
    <NavigationContainer>
      <AuthProvider>
        <AppRoutes />
        <StatusBar style="auto" />
      </AuthProvider>
    </NavigationContainer>
  );
}

import { View, Text, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
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
    color: '#6B7280',
    textAlign: 'center',
  },
});
