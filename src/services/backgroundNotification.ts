import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ID = 'recording';
const NOTIFICATION_ID = 'momai-recording';

let channelReady = false;

async function ensureChannel() {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Recording',
    importance: Notifications.AndroidImportance.LOW,
    sound: undefined,
    vibrationPattern: [0],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  channelReady = true;
}

/**
 * Show a sticky "Recording in progress" notification.
 * On Android this keeps the process visible to the OS and less likely to be killed.
 */
export async function showRecordingNotification() {
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: 'Smart Mom',
        body: 'Recording in progress…',
        sticky: true,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[notification] show failed:', e);
  }
}

export async function updateRecordingNotification(body: string) {
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: 'Smart MoM',
        body,
        sticky: true,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[notification] update failed:', e);
  }
}

export async function dismissRecordingNotification() {
  try {
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  } catch (e) {
    console.warn('[notification] dismiss failed:', e);
  }
}
