import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBackendUrl, setBackendUrl, DEFAULT_BACKEND_URL } from '../src/constants';
import { C } from '../src/constants';

export default function SettingsScreen() {
  const ins = useSafeAreaInsets();
  const [url,     setUrl]     = useState('');
  const [testing, setTesting] = useState(false);
  const [result,  setResult]  = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => { setUrl(getBackendUrl()); }, []);

  const handleTest = async () => {
    if (!url.trim()) return;
    setTesting(true);
    setResult(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${url.trim().replace(/\/$/, '')}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        setResult({ ok: true, msg: `✓ Connected! Server responded ${res.status}` });
      } else {
        setResult({ ok: false, msg: `✗ Server returned ${res.status}` });
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setResult({ ok: false, msg: '✗ Timed out — server not responding' });
      } else {
        setResult({ ok: false, msg: `✗ ${e?.message || 'Cannot reach server'}` });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const clean = url.trim().replace(/\/$/, '');
    if (!clean.startsWith('http')) {
      Alert.alert('Invalid URL', 'URL must start with http:// or https://');
      return;
    }
    await setBackendUrl(clean);
    Alert.alert('Saved', 'Backend URL updated. Restart the app if you are already signed in.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  const handleReset = async () => {
    setUrl(DEFAULT_BACKEND_URL);
    await setBackendUrl(DEFAULT_BACKEND_URL);
    setResult(null);
  };

  return (
    <ScrollView style={[s.root, { paddingTop: ins.top }]} contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled">

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.back}>
          <Text style={s.backTxt}>←  Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Server Settings</Text>
      </View>

      <View style={s.card}>
        <Text style={s.lbl}>Backend URL</Text>
        <Text style={s.hint}>
          The URL of your backend server. If you are using a Cloudflare tunnel,
          paste the new URL here every time the tunnel restarts.
        </Text>
        <TextInput
          style={s.input}
          value={url}
          onChangeText={v => { setUrl(v); setResult(null); }}
          placeholder="https://your-tunnel.trycloudflare.com"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        {/* Test result */}
        {result && (
          <View style={[s.resultBox, { backgroundColor: result.ok ? C.successBg : C.errorBg, borderColor: result.ok ? '#16a34a40' : '#dc262640' }]}>
            <Text style={[s.resultTxt, { color: result.ok ? C.success : C.error }]}>{result.msg}</Text>
          </View>
        )}

        <View style={s.btnRow}>
          <TouchableOpacity style={s.testBtn} onPress={handleTest} disabled={testing || !url.trim()} activeOpacity={0.8}>
            {testing
              ? <ActivityIndicator size="small" color={C.accent} />
              : <Text style={s.testBtnTxt}>Test Connection</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={!url.trim()} activeOpacity={0.85}>
            <Text style={s.saveBtnTxt}>Save</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleReset} style={s.resetBtn}>
          <Text style={s.resetTxt}>Reset to default ({DEFAULT_BACKEND_URL})</Text>
        </TouchableOpacity>
      </View>

      <View style={s.infoCard}>
        <Text style={s.infoTitle}>Cloudflare Tunnel Setup</Text>
        <Text style={s.infoTxt}>
          Every time you restart the Cloudflare tunnel, a new URL is generated.{'\n\n'}
          Run on your server machine:{'\n'}
          {'  '}cloudflared tunnel --url http://localhost:8000{'\n\n'}
          Copy the printed URL (e.g. https://abc-xyz.trycloudflare.com) and paste it above.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: C.bg },
  content:   { padding: 20, paddingBottom: 48 },
  header:    { marginBottom: 24 },
  back:      { marginBottom: 8 },
  backTxt:   { fontSize: 14, color: C.accent, fontWeight: '500' },
  title:     { fontSize: 22, fontWeight: '700', color: C.text, letterSpacing: -0.4 },
  card:      { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 20, marginBottom: 16 },
  lbl:       { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 4 },
  hint:      { fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 18 },
  input:     { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 13, fontSize: 13, color: C.text, fontFamily: 'monospace' },
  resultBox: { borderRadius: 8, padding: 12, marginTop: 12, borderWidth: 1 },
  resultTxt: { fontSize: 13, fontWeight: '500' },
  btnRow:    { flexDirection: 'row', gap: 10, marginTop: 14 },
  testBtn:   { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2, paddingVertical: 13, alignItems: 'center' },
  testBtnTxt:{ fontSize: 13, fontWeight: '600', color: C.dim },
  saveBtn:   { flex: 1, borderRadius: 10, backgroundColor: C.accent, paddingVertical: 13, alignItems: 'center' },
  saveBtnTxt:{ fontSize: 13, fontWeight: '700', color: C.white },
  resetBtn:  { marginTop: 14, alignItems: 'center' },
  resetTxt:  { fontSize: 11, color: C.muted },
  infoCard:  { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 18 },
  infoTitle: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 10 },
  infoTxt:   { fontSize: 12, color: C.dim, lineHeight: 20, fontFamily: 'monospace' },
});
