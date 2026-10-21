import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect, NavigationProp } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Notification } from '@parkwise/shared';
import { useTheme } from '../contexts/AccessibilityContext';
import { radius, spacing, type as typeToken } from '../theme/tokens';
import { Card, EmptyState, ScreenHeader, SkeletonList, StatusChip } from '../components/ui';
import type { ChipTone } from '../components/ui';
import AppScreen from '../components/AppScreen';
import {
  DEFAULT_NOTIFICATION_PREFS,
  loadNotificationPrefs,
  notificationAllowedByPrefs,
  NotificationPrefs,
} from '../utils/notificationPrefs';

type RootStackParamList = {
  Notifications: undefined;
};

interface TypeVisual {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: ChipTone;
}

const TYPE_VISUAL: Record<string, TypeVisual> = {
  reservation: { icon: 'calendar-outline', tone: 'brand' },
  verification: { icon: 'shield-checkmark-outline', tone: 'success' },
  payment: { icon: 'card-outline', tone: 'info' },
  penalty: { icon: 'alert-circle-outline', tone: 'danger' },
  system: { icon: 'megaphone-outline', tone: 'neutral' },
};

export default function NotificationsScreen() {
  const { profile } = useAuth();
  const { colors, textScale } = useTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);

  // Re-read on every focus, not just on mount, so a preference changed in
  // Settings applies the moment you come back to this screen.
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      loadNotificationPrefs().then((loaded) => {
        if (!cancelled) setPrefs(loaded);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    loadNotifications();

    // Subscribe to notification changes via Realtime
    const subscription = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile?.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setNotifications(prev => [payload.new as Notification, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setNotifications(prev =>
              prev.map(n => n.id === payload.new.id ? payload.new as Notification : n)
            );
          } else if (payload.eventType === 'DELETE') {
            setNotifications(prev => prev.filter(n => n.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [profile?.id]);

  const loadNotifications = async () => {
    if (!supabase || !profile?.id) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    if (!supabase) return;

    try {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const toneColors: Record<ChipTone, { bg: string; fg: string }> = {
    success: { bg: colors.successTint, fg: colors.success },
    warning: { bg: colors.warningTint, fg: colors.warning },
    danger: { bg: colors.dangerTint, fg: colors.danger },
    info: { bg: colors.infoTint, fg: colors.info },
    neutral: { bg: colors.neutralTint, fg: colors.neutral },
    brand: { bg: colors.tealTint, fg: colors.tealDark },
  };

  const visibleNotifications = notifications.filter((n) =>
    notificationAllowedByPrefs(n.type, prefs)
  );
  const unreadCount = visibleNotifications.filter(n => !n.is_read).length;

  return (
    <AppScreen
      header={
        <ScreenHeader
          title="Notifications"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          onBack={() => navigation.goBack()}
        />
      }
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <SkeletonList rows={4} />
      ) : visibleNotifications.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="No notifications"
          message="You're all caught up. We'll let you know about important updates."
        />
      ) : (
        visibleNotifications.map(notification => {
          const visual = TYPE_VISUAL[notification.type] ?? TYPE_VISUAL.system;
          const { bg, fg } = toneColors[visual.tone];
          const unread = !notification.is_read;
          const relativeTime = formatDate(notification.created_at);

          return (
            <Card
              key={notification.id}
              style={styles.card}
              onPress={unread ? () => markAsRead(notification.id) : undefined}
              accessibilityLabel={`${unread ? 'Unread. ' : ''}${notification.title}. ${
                notification.body
              }. ${relativeTime}`}
              accessibilityHint={unread ? 'Marks this notification as read' : undefined}
            >
              <View style={styles.row}>
                <View
                  style={[styles.iconBubble, { backgroundColor: bg }]}
                  accessible={false}
                  importantForAccessibility="no"
                >
                  <Ionicons name={visual.icon} size={20} color={fg} />
                </View>

                <View style={styles.body}>
                  <View style={styles.titleRow}>
                    <Text
                      style={[typeToken('subtitle', textScale), styles.title, { color: colors.text }]}
                    >
                      {notification.title}
                    </Text>
                    {unread ? <StatusChip label="New" tone="info" /> : null}
                  </View>

                  <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>
                    {notification.body}
                  </Text>

                  <Text
                    style={[typeToken('small', textScale), styles.time, { color: colors.textMuted }]}
                  >
                    {relativeTime}
                  </Text>
                </View>
              </View>
            </Card>
          );
        })
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: spacing.xxs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  title: {
    flexShrink: 1,
  },
  time: {
    marginTop: spacing.xxs,
  },
});
