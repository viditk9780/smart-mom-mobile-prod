import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  Image,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { login } from '../../src/services/auth';
import { C } from '../../src/constants';

export default function LoginScreen() {
  const ins = useSafeAreaInsets();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [done,     setDone]     = useState(false);

  if (done) return <Redirect href="/record" />;

  const handleLogin = async () => {
    if (!email.trim() || !password) { setError('Email and password are required.'); return; }
    setLoading(true); setError('');
    try {
      await login(email.trim().toLowerCase(), password);
      setDone(true);
    } catch (e: any) {
      setError(e?.message || 'Login failed.');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: ins.top + 48 }]}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <View style={s.logoWrap}>
          <Image source={require('../../assets/smart-mom.png')} style={s.logoImg} resizeMode="contain" />
          <Text style={s.brand}>Smart MoM</Text>
          <Text style={s.tagline}>AI-powered meeting minutes</Text>
        </View>

        <View style={s.card}>
          <Text style={s.title}>Welcome back</Text>
          <Text style={s.sub}>Sign in to start recording</Text>

          <View style={s.field}>
            <Text style={s.lbl}>Email</Text>
            <TextInput style={[s.input, loading && s.disabled]} placeholder="you@example.com"
              placeholderTextColor={C.muted} value={email}
              onChangeText={t => { setEmail(t); setError(''); }}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} editable={!loading} />
          </View>

          <View style={s.field}>
            <Text style={s.lbl}>Password</Text>
            <TextInput style={[s.input, loading && s.disabled]} placeholder="••••••••"
              placeholderTextColor={C.muted} value={password}
              onChangeText={t => { setPassword(t); setError(''); }}
              secureTextEntry editable={!loading} />
          </View>

          {!!error && <View style={s.err}><Text style={s.errTxt}>⚠  {error}</Text></View>}

          <TouchableOpacity style={[s.btn, (loading || !email || !password) && s.btnOff]}
            onPress={handleLogin} disabled={loading || !email.trim() || !password} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color={C.white} /> : <Text style={s.btnTxt}>Sign In</Text>}
          </TouchableOpacity>

          <View style={s.footer}>
            <Text style={s.footerTxt}>No account? </Text>
            <TouchableOpacity onPress={() => router.replace('/auth/register')} disabled={loading}>
              <Text style={s.link}>Register</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:     { flex:1, backgroundColor:C.bg },
  scroll:   { flexGrow:1, padding:24, paddingBottom:48 },
  logoWrap: { alignItems:'center', marginBottom:40 },
  logoImg:  { width: 160, height: 90, marginBottom: 10 },
  brand:    { fontSize:22, fontWeight:'700', color:C.text, letterSpacing:-0.4 },
  tagline:  { fontSize:13, color:C.muted, marginTop:4 },
  card:     { backgroundColor:C.surface, borderRadius:18, borderWidth:1, borderColor:C.border, padding:24 },
  title:    { fontSize:20, fontWeight:'700', color:C.text, marginBottom:4 },
  sub:      { fontSize:13, color:C.dim, marginBottom:24 },
  field:    { marginBottom:16 },
  lbl:      { fontSize:13, fontWeight:'600', color:C.text, marginBottom:6 },
  input:    { backgroundColor:C.surface2, borderWidth:1, borderColor:C.border, borderRadius:10, padding:13, fontSize:15, color:C.text },
  disabled: { opacity:0.6 },
  err:      { backgroundColor:C.errorBg, borderRadius:8, padding:12, marginBottom:12, borderWidth:1, borderColor:'rgba(220,38,38,0.2)' },
  errTxt:   { color:C.error, fontSize:13, lineHeight:18 },
  btn:      { backgroundColor:C.accent, borderRadius:12, paddingVertical:15, alignItems:'center', marginTop:4 },
  btnOff:   { opacity:0.5 },
  btnTxt:   { color:C.white, fontSize:15, fontWeight:'600' },
  footer:   { flexDirection:'row', justifyContent:'center', marginTop:24 },
  footerTxt:{ fontSize:13, color:C.dim },
  link:     { fontSize:13, color:C.accent, fontWeight:'600' },
});
