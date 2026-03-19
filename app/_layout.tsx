import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowInForeground: false,
  }),
});

export default function RootLayout() {
  useEffect(() => {
    Notifications.requestPermissionsAsync().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={s.root}>
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#fefbf0" />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({ root: { flex: 1 } });
