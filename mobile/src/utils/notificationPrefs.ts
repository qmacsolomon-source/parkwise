// Local (per-device) notification preferences. There is no server-side
// concept of "this customer doesn't want penalty reminders" - notifications
// are written by the database/desktop side regardless - so these toggles
// only control what NotificationsScreen chooses to display, not what gets
// created. Shared between SettingsScreen (where they're edited) and
// NotificationsScreen (where they're applied) so both read the exact same
// key, shape and default.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationType } from '@parkwise/shared';

export interface NotificationPrefs {
  bookingUpdates: boolean;
  penaltyReminders: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  bookingUpdates: true,
  penaltyReminders: true,
};

export const NOTIFICATION_PREFS_KEY = '@parkwise/notification-prefs:v1';

export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    return { ...DEFAULT_NOTIFICATION_PREFS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) };
  } catch (error) {
    console.warn('[notifications] could not read notification preferences:', error);
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

/** Which preference, if any, governs a notification of this type. */
const TYPE_PREF_KEY: Partial<Record<NotificationType, keyof NotificationPrefs>> = {
  reservation: 'bookingUpdates',
  verification: 'bookingUpdates',
  payment: 'bookingUpdates',
  system: 'bookingUpdates',
  penalty: 'penaltyReminders',
};

/** True when `prefs` allows a notification of this type to be shown. */
export function notificationAllowedByPrefs(
  type: NotificationType | string,
  prefs: NotificationPrefs
): boolean {
  const key = TYPE_PREF_KEY[type as NotificationType];
  return key ? prefs[key] : true;
}
