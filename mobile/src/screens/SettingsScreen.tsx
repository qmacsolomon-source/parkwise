import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Switch, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, useFocusEffect, NavigationProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService, supabase, getPwdPermitPhotoUrl } from '@parkwise/shared';
import { uploadMyPwdPermitPhoto } from '../utils/pwdPermitPhoto';

import AppScreen from '../components/AppScreen';
import SegmentedControl from '../components/SegmentedControl';
import {
  BottomSheet,
  Button,
  Card,
  ListRow,
  SectionHeader,
  ScreenHeader,
  StatusChip,
  TextField,
  useToast,
} from '../components/ui';
import type { ChipTone } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/AccessibilityContext';
import { spacing, radius, TOUCH_TARGET, type as typeToken, type TextSize } from '../theme/tokens';

type RootStackParamList = {
  Dashboard: undefined;
  Settings: undefined;
  MyVehicles: undefined;
  Notifications: undefined;
};

const TEXT_SIZE_OPTIONS: { label: string; value: TextSize }[] = [
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
];

/** Notification choices are stored on the device (there is no push service yet). */
const NOTIFICATION_PREFS_KEY = '@parkwise/notification-prefs:v1';

interface NotificationPrefs {
  bookingUpdates: boolean;
  penaltyReminders: boolean;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  bookingUpdates: true,
  penaltyReminders: true,
};

function formatMoney(amount: number): string {
  return `₱${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function SettingsScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute();
  const autoOpenPwd = (route.params as { autoOpenPwd?: boolean } | undefined)?.autoOpenPwd;
  const { profile, user, logout, refreshProfile } = useAuth();

  // Staff actions (PWD verification, etc.) happen outside this app, so the
  // cached profile only catches up when refetched - do that every time this
  // screen gains focus, not just after an action taken here.
  useFocusEffect(
    useCallback(() => {
      refreshProfile();
    }, [refreshProfile])
  );
  const { showToast } = useToast();
  const {
    colors,
    textScale,
    textSize,
    setTextSize,
    highContrast,
    setHighContrast,
    reduceMotion,
    setReduceMotion,
    systemReduceMotion,
  } = useTheme();

  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // --- edit profile -------------------------------------------------------
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // --- change password ----------------------------------------------------
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // --- PWD permit ---------------------------------------------------------
  const [pwdOpen, setPwdOpen] = useState(false);
  const [permitNumber, setPermitNumber] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  // A newly-picked photo waiting to be uploaded on Submit - kept separate
  // from what's already on file so re-opening the sheet doesn't imply a
  // fresh photo was chosen when it wasn't.
  const [newPermitPhoto, setNewPermitPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [existingPermitPhotoUrl, setExistingPermitPhotoUrl] = useState<string | null>(null);

  // --- delete account -----------------------------------------------------
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [unpaidTotal, setUnpaidTotal] = useState<number | null>(null);

  // --- notification preferences ------------------------------------------
  const [notificationPrefs, setNotificationPrefs] =
    useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(NOTIFICATION_PREFS_KEY);
        if (cancelled || !raw) return;
        setNotificationPrefs({
          ...DEFAULT_NOTIFICATION_PREFS,
          ...(JSON.parse(raw) as Partial<NotificationPrefs>),
        });
      } catch (error) {
        console.warn('[settings] could not read notification preferences:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateNotificationPref = (key: keyof NotificationPrefs, value: boolean) => {
    const next = { ...notificationPrefs, [key]: value };
    setNotificationPrefs(next);
    AsyncStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(next)).catch((error) =>
      console.warn('[settings] could not save notification preferences:', error)
    );
  };

  // Unpaid penalties are read once so the deletion warning can be specific.
  useEffect(() => {
    if (!supabase || !profile?.id) {
      setUnpaidTotal(null);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('penalties')
        .select('amount')
        .eq('customer_id', profile.id)
        .eq('status', 'unpaid');

      if (cancelled || error) return;
      setUnpaidTotal(
        (data ?? []).reduce((sum, row) => sum + (Number((row as { amount: number }).amount) || 0), 0)
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  // --- derived display values --------------------------------------------
  const sessionEmail: string | null = typeof user?.email === 'string' ? user.email : null;
  const displayName = profile?.full_name || sessionEmail?.split('@')[0] || 'Signed in';
  const displayEmail = profile?.email || sessionEmail || 'No email on file';

  const pwdStatus: { label: string; tone: ChipTone } = profile?.pwd_verified
    ? { label: 'Verified', tone: 'success' }
    : profile?.pwd_permit_number
      ? { label: 'Pending', tone: 'warning' }
      : { label: 'Not submitted', tone: 'neutral' };

  const initials =
    displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'PW';

  // --- handlers -----------------------------------------------------------
  const handleSignOut = async () => {
    try {
      await logout();
    } finally {
      setConfirmSignOut(false);
    }
  };

  const openEditProfile = () => {
    setEditName(profile?.full_name ?? '');
    setEditPhone(profile?.phone ?? '');
    setEditError(null);
    setEditOpen(true);
  };

  const saveProfile = async () => {
    if (!profile?.id) {
      setEditError('Your profile could not be found. Please sign in again.');
      return;
    }
    if (!editName.trim()) {
      setEditError('Enter your name.');
      return;
    }
    if (!/^\d{11}$/.test(editPhone.replace(/\D/g, ''))) {
      setEditError('Enter an 11-digit phone number.');
      return;
    }

    setEditBusy(true);
    setEditError(null);
    try {
      await authService.updateProfile(profile.id, {
        full_name: editName.trim(),
        phone: editPhone.trim(),
      });
      await refreshProfile();
      setEditOpen(false);
      showToast('Profile updated.', 'success');
    } catch (error) {
      setEditError(messageFor(error, 'Could not save your profile.'));
    } finally {
      setEditBusy(false);
    }
  };

  const openChangePassword = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordError(null);
    setPasswordOpen(true);
  };

  const savePassword = async () => {
    if (!currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Your new password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('The new passwords do not match.');
      return;
    }

    setPasswordBusy(true);
    setPasswordError(null);
    try {
      await authService.changePassword(currentPassword, newPassword);
      setPasswordOpen(false);
      showToast('Password changed.', 'success');
    } catch (error) {
      setPasswordError(messageFor(error, 'Could not change your password.'));
    } finally {
      setPasswordBusy(false);
    }
  };

  const openPwdPermit = () => {
    setPermitNumber(profile?.pwd_permit_number ?? '');
    setPwdError(null);
    setNewPermitPhoto(null);
    setExistingPermitPhotoUrl(null);
    setPwdOpen(true);

    if (profile?.pwd_permit_photo_path) {
      getPwdPermitPhotoUrl(profile.pwd_permit_photo_path).then(setExistingPermitPhotoUrl);
    }
  };

  // Landed here straight from registration/login because pwd_intent is set
  // but nothing's been submitted yet - open the sheet once so there's no
  // extra tap to find it.
  const autoOpenedPwdRef = useRef(false);
  useEffect(() => {
    if (autoOpenPwd && profile && !profile.pwd_permit_number && !autoOpenedPwdRef.current) {
      autoOpenedPwdRef.current = true;
      openPwdPermit();
    }
  }, [autoOpenPwd, profile]);

  const pickPermitPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPwdError('Photo library access is needed to attach a permit photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets[0]?.base64) {
      setNewPermitPhoto({ uri: result.assets[0].uri, base64: result.assets[0].base64 });
      setPwdError(null);
    }
  };

  const savePwdPermit = async () => {
    if (!permitNumber.trim()) {
      setPwdError('Enter your PWD permit number.');
      return;
    }

    setPwdBusy(true);
    setPwdError(null);
    try {
      let photoPath: string | undefined;
      if (newPermitPhoto) {
        photoPath = await uploadMyPwdPermitPhoto(newPermitPhoto.uri, newPermitPhoto.base64);
      }
      await authService.submitPwdPermit(permitNumber.trim(), photoPath);
      await refreshProfile();
      setPwdOpen(false);
      setNewPermitPhoto(null);
      showToast('Permit number submitted for verification.', 'success');
    } catch (error) {
      setPwdError(messageFor(error, 'Could not submit your permit number.'));
    } finally {
      setPwdBusy(false);
    }
  };

  const confirmDeleteRequest = async () => {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await authService.requestAccountDeletion();
      setDeleteOpen(false);
      showToast('Deletion request sent. Staff will contact you.', 'info');
    } catch (error) {
      setDeleteError(messageFor(error, 'Could not send your request.'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const deleteWarning =
    unpaidTotal && unpaidTotal > 0
      ? `You still have ${formatMoney(unpaidTotal)} in unpaid penalties. Settle them at the attendant counter before your account can be closed.`
      : 'Any unpaid penalties must be settled at the attendant counter before your account can be closed.';

  return (
    <AppScreen header={<ScreenHeader title="Settings" onBack={() => navigation.goBack()} />} scroll>
      <SectionHeader title="Account" />
      <Card>
        <View style={styles.profileRow}>
          <View
            style={[styles.avatar, { backgroundColor: colors.tealTint, borderColor: colors.teal }]}
            accessible={false}
            importantForAccessibility="no"
          >
            <Text style={[typeToken('title', textScale), { color: colors.tealDark }]}>{initials}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={[typeToken('title', textScale), { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[typeToken('small', textScale), { color: colors.textMuted }]} numberOfLines={1}>
              {displayEmail}
            </Text>
          </View>
        </View>

        <Divider />

        <ListRow title="Phone" value={profile?.phone || '—'} icon="call-outline" />
        <ListRow title="Role" value={profile?.role ?? '—'} icon="shield-checkmark-outline" />

        <Divider />

        <ListRow
          title="Edit profile"
          subtitle="Your name and phone number"
          icon="create-outline"
          onPress={openEditProfile}
          accessibilityHint="Opens a form to change your name and phone number"
        />
        <ListRow
          title="Change password"
          subtitle="Confirm your current password first"
          icon="lock-closed-outline"
          onPress={openChangePassword}
          accessibilityHint="Opens a form to change your password"
        />
        <ListRow
          title="Registered vehicles"
          subtitle="Add, edit or remove your vehicles"
          icon="car-outline"
          onPress={() => navigation.navigate('MyVehicles')}
          accessibilityHint="Opens your registered vehicles"
          style={styles.lastRow}
        />
      </Card>

      <SectionHeader title="PWD permit" style={styles.sectionSpacing} />
      <Card>
        <View style={styles.statusRow}>
          <View style={styles.flexText}>
            <Text style={[typeToken('bodyStrong', textScale), { color: colors.text }]}>
              Verification
            </Text>
            <Text
              style={[typeToken('small', textScale), { color: colors.textMuted, marginTop: spacing.xxs }]}
            >
              {profile?.pwd_verified
                ? 'Your permit is verified, so PWD bays are offered to you first.'
                : profile?.pwd_permit_number
                  ? `Permit ${profile.pwd_permit_number} is waiting for staff verification.`
                  : 'Submit your PWD permit number and staff will verify it.'}
            </Text>
          </View>
          <StatusChip label={pwdStatus.label} tone={pwdStatus.tone} />
        </View>

        {!profile?.pwd_verified ? (
          <Button
            label={profile?.pwd_permit_number ? 'Update permit number' : 'Submit permit number'}
            variant="secondary"
            icon="card-outline"
            onPress={openPwdPermit}
            style={styles.cardAction}
            accessibilityHint="Submits your PWD permit number for staff verification"
          />
        ) : null}
      </Card>

      <SectionHeader title="Notifications" style={styles.sectionSpacing} />
      <Card>
        <ToggleRow
          title="Booking updates"
          description="Confirmations, slot changes and reminders about your booking."
          value={notificationPrefs.bookingUpdates}
          onValueChange={(value) => updateNotificationPref('bookingUpdates', value)}
        />

        <Divider />

        <ToggleRow
          title="Penalty reminders"
          description="A nudge when you have an unpaid penalty."
          value={notificationPrefs.penaltyReminders}
          onValueChange={(value) => updateNotificationPref('penaltyReminders', value)}
        />

        <Divider />

        <ListRow
          title="Notification history"
          subtitle="Everything ParkWise has sent you"
          icon="notifications-outline"
          onPress={() => navigation.navigate('Notifications')}
          style={styles.lastRow}
        />

        <Text style={[typeToken('small', textScale), styles.note, { color: colors.textMuted }]}>
          Preferences are saved on this device.
        </Text>
      </Card>

      <SectionHeader title="Accessibility" style={styles.sectionSpacing} />
      <Card>
        <View>
          <Text style={[typeToken('bodyStrong', textScale), { color: colors.text }]}>Text size</Text>
          <Text
            style={[typeToken('small', textScale), { color: colors.textMuted, marginTop: spacing.xxs }]}
          >
            Adjusts the size of text across ParkWise.
          </Text>
          <SegmentedControl
            options={TEXT_SIZE_OPTIONS}
            value={textSize}
            onChange={setTextSize}
            accessibilityLabel="Text size"
            style={{ marginTop: spacing.sm }}
          />
        </View>

        <Divider />

        <ToggleRow
          title="High contrast"
          description="Uses a darker theme with stronger colour contrast."
          value={highContrast}
          onValueChange={setHighContrast}
        />

        <Divider />

        <ToggleRow
          title="Reduce motion"
          description="Minimises slide and fade animations."
          value={reduceMotion}
          onValueChange={setReduceMotion}
        />
        {systemReduceMotion ? (
          <View style={styles.noteRow}>
            <Ionicons name="information-circle" size={16} color={colors.info} />
            <Text style={[typeToken('small', textScale), styles.noteText, { color: colors.info }]}>
              {"Your phone's system \"Reduce Motion\" setting is also on."}
            </Text>
          </View>
        ) : null}

        <Divider />

        <ListRow
          title="Screen reader hints"
          subtitle="VoiceOver and TalkBack announce a label for every button, switch and field, so you always know what each control does."
          icon="help-buoy-outline"
          style={styles.lastRow}
        />
      </Card>

      <SectionHeader title="About" style={styles.sectionSpacing} />
      <Card>
        <ListRow title="App version" value="1.0.0" icon="phone-portrait-outline" />
        <ListRow title="ParkWise" value="Customer app" icon="car-outline" style={styles.lastRow} />
      </Card>

      <Button
        label="Request account deletion"
        variant="danger"
        icon="trash-outline"
        onPress={() => {
          setDeleteError(null);
          setDeleteOpen(true);
        }}
        accessibilityHint="Asks staff to close your account. Unpaid penalties must be settled first."
        style={styles.dangerAction}
      />

      <Button
        label="Sign out"
        variant="danger"
        icon="log-out-outline"
        onPress={() => setConfirmSignOut(true)}
        accessibilityHint="Opens a confirmation before signing out of your account."
        style={styles.signOut}
      />

      {/* --- edit profile --- */}
      <BottomSheet
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        dismissible={!editBusy}
        title="Edit profile"
        description="Your name is shown on the Home greeting; the phone number is for staff contact."
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setEditOpen(false)}
              disabled={editBusy}
              style={styles.sheetButton}
            />
            <Button
              label="Save"
              onPress={saveProfile}
              loading={editBusy}
              style={styles.sheetButton}
            />
          </>
        }
      >
        <TextField
          label="Full name"
          value={editName}
          onChangeText={setEditName}
          autoCapitalize="words"
          editable={!editBusy}
          leadingIcon="person-outline"
          invalid={!!editError}
        />
        <View style={styles.sheetField}>
          <TextField
            label="Phone number"
            value={editPhone}
            onChangeText={setEditPhone}
            placeholder="09123456789"
            keyboardType="phone-pad"
            maxLength={11}
            editable={!editBusy}
            leadingIcon="call-outline"
            invalid={!!editError}
            message={editError ?? undefined}
          />
        </View>
      </BottomSheet>

      {/* --- change password --- */}
      <BottomSheet
        visible={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        dismissible={!passwordBusy}
        title="Change password"
        description="For your safety we ask for your current password again."
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setPasswordOpen(false)}
              disabled={passwordBusy}
              style={styles.sheetButton}
            />
            <Button
              label="Change"
              onPress={savePassword}
              loading={passwordBusy}
              style={styles.sheetButton}
            />
          </>
        }
      >
        <TextField
          label="Current password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          editable={!passwordBusy}
          leadingIcon="lock-closed-outline"
          invalid={!!passwordError}
        />
        <View style={styles.sheetField}>
          <TextField
            label="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            editable={!passwordBusy}
            leadingIcon="lock-closed-outline"
            invalid={!!passwordError}
          />
        </View>
        <View style={styles.sheetField}>
          <TextField
            label="Confirm new password"
            value={confirmNewPassword}
            onChangeText={setConfirmNewPassword}
            secureTextEntry
            editable={!passwordBusy}
            leadingIcon="lock-closed-outline"
            invalid={!!passwordError}
            message={passwordError ?? undefined}
          />
        </View>
      </BottomSheet>

      {/* --- PWD permit --- */}
      <BottomSheet
        visible={pwdOpen}
        onClose={() => setPwdOpen(false)}
        dismissible={!pwdBusy}
        title="PWD permit number"
        description="Only staff can verify the permit. Until then your account shows as pending."
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setPwdOpen(false)}
              disabled={pwdBusy}
              style={styles.sheetButton}
            />
            <Button
              label="Submit"
              onPress={savePwdPermit}
              loading={pwdBusy}
              style={styles.sheetButton}
            />
          </>
        }
      >
        <TextField
          label="Permit number"
          value={permitNumber}
          onChangeText={setPermitNumber}
          placeholder="Enter permit number"
          autoCapitalize="characters"
          editable={!pwdBusy}
          leadingIcon="card-outline"
          invalid={!!pwdError}
          message={pwdError ?? undefined}
        />

        {!profile?.pwd_verified ? (
          <View style={styles.permitPhotoSection}>
            <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>
              Photo of permit (recommended - helps staff verify it faster)
            </Text>
            {newPermitPhoto ? (
              <Image source={{ uri: newPermitPhoto.uri }} style={styles.permitPhotoPreview} />
            ) : existingPermitPhotoUrl ? (
              <Image source={{ uri: existingPermitPhotoUrl }} style={styles.permitPhotoPreview} />
            ) : null}
            <Button
              label={newPermitPhoto || existingPermitPhotoUrl ? 'Change photo' : 'Add photo'}
              variant="secondary"
              icon="camera-outline"
              onPress={pickPermitPhoto}
              disabled={pwdBusy}
              style={styles.permitPhotoButton}
            />
          </View>
        ) : null}

        {profile?.pwd_verified ? (
          <Text style={[typeToken('small', textScale), styles.sheetNote, { color: colors.success }]}>
            Your permit is already verified. Contact the counter if it needs to change.
          </Text>
        ) : null}
      </BottomSheet>

      {/* --- delete account --- */}
      <BottomSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        dismissible={!deleteBusy}
        title="Request account deletion?"
        description={`This asks staff to close your account and remove your data. ${deleteWarning} Nothing is deleted until staff review the request.`}
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setDeleteOpen(false)}
              disabled={deleteBusy}
              style={styles.sheetButton}
            />
            <Button
              label="Send request"
              variant="danger"
              onPress={confirmDeleteRequest}
              loading={deleteBusy}
              style={styles.sheetButton}
            />
          </>
        }
      >
        {deleteError ? (
          <View style={styles.alertRow}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={[typeToken('body', textScale), styles.flexText, { color: colors.danger }]}>
              {deleteError}
            </Text>
          </View>
        ) : null}
      </BottomSheet>

      {/* --- sign out --- */}
      <BottomSheet
        visible={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title="Sign out?"
        description="You will need to sign in again to book a slot or view your parking."
        footer={
          <>
            <View style={styles.sheetButton}>
              <Button label="Cancel" variant="secondary" onPress={() => setConfirmSignOut(false)} />
            </View>
            <View style={styles.sheetButton}>
              <Button label="Sign out" variant="danger" onPress={handleSignOut} />
            </View>
          </>
        }
      />
    </AppScreen>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

function ToggleRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { colors, textScale } = useTheme();

  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={[typeToken('bodyStrong', textScale), { color: colors.text }]}>{title}</Text>
        <Text
          style={[typeToken('small', textScale), { color: colors.textMuted, marginTop: spacing.xxs }]}
        >
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={title}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        trackColor={{ false: colors.borderStrong, true: colors.teal }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flexText: {
    flex: 1,
  },
  sectionSpacing: {
    marginTop: spacing.lg,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.sm,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardAction: {
    marginTop: spacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH_TARGET,
  },
  toggleText: {
    flex: 1,
  },
  note: {
    marginTop: spacing.sm,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  noteText: {
    flex: 1,
  },
  dangerAction: {
    marginTop: spacing.lg,
  },
  signOut: {
    marginTop: spacing.sm,
  },
  sheetButton: {
    flex: 1,
  },
  sheetField: {
    marginTop: spacing.md,
  },
  sheetNote: {
    marginTop: spacing.sm,
  },
  permitPhotoSection: {
    marginTop: spacing.md,
  },
  permitPhotoPreview: {
    width: 160,
    height: 100,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  permitPhotoButton: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
