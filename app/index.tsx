import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { getToken } from '../src/services/auth';
import { initBackendUrl } from '../src/constants';

export default function RootIndex() {
  const [status, setStatus] = useState<'loading' | 'auth' | 'noauth'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Always init backend URL first (loads saved override from AsyncStorage)
      await initBackendUrl();
      try {
        const token = await getToken();
        if (!cancelled) setStatus(token ? 'auth' : 'noauth');
      } catch {
        if (!cancelled) setStatus('noauth');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (status === 'loading') {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#d4a020" />
      </View>
    );
  }
  return status === 'auth' ? <Redirect href="/record" /> : <Redirect href="/auth/login" />;
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fefbf0' },
});
