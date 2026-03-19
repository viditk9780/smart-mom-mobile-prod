import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { register } from '../../src/services/auth';
import { C } from '../../src/constants';

export default function RegisterScreen() {
  const ins = useSafeAreaInsets();
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [done,     setDone]     = useState(false);

  if (done) return <Redirect href="/record" />;

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) { setError('All fields are required.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true); setError('');
    try {
      await register(email.trim().toLowerCase(), password, name.trim());
      setDone(true);
    } catch (e: any) {
      setError(e?.message || 'Registration failed.');
    } finally { setLoading(false); }
  };

  const fields = [
    { label:'Full Name', val:name,     set:setName,     ph:'John Doe',        kb:'default' as const,       cap:'words' as const, secure:false },
    { label:'Email',     val:email,    set:setEmail,    ph:'you@example.com', kb:'email-address' as const, cap:'none' as const,  secure:false },
    { label:'Password',  val:password, set:setPassword, ph:'8+ characters',   kb:'default' as const,       cap:'none' as const,  secure:true  },
  ];

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: ins.top + 24 }]}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <TouchableOpacity onPress={() => router.replace('/auth/login')} disabled={loading} style={s.back}>
          <Text style={s.backTxt}>← Back to Sign In</Text>
        </TouchableOpacity>

        <View style={s.header}>
          <Text style={s.title}>Create Account</Text>
          <Text style={s.sub}>Start capturing your meetings with AI</Text>
        </View>

        <View style={s.card}>
          {fields.map(f => (
            <View key={f.label} style={s.field}>
              <Text style={s.lbl}>{f.label}</Text>
              <TextInput style={[s.input, loading && s.disabled]} placeholder={f.ph}
                placeholderTextColor={C.muted} value={f.val}
                onChangeText={t => { f.set(t); setError(''); }}
                keyboardType={f.kb} autoCapitalize={f.cap}
                secureTextEntry={f.secure} autoCorrect={false} editable={!loading} />
            </View>
          ))}

          {!!error && <View style={s.err}><Text style={s.errTxt}>⚠  {error}</Text></View>}

          <TouchableOpacity style={[s.btn, (loading || !name || !email || !password) && s.btnOff]}
            onPress={handleRegister} disabled={loading || !name.trim() || !email.trim() || !password}
            activeOpacity={0.85}>
            {loading ? <ActivityIndicator color={C.white} /> : <Text style={s.btnTxt}>Create Account</Text>}
          </TouchableOpacity>

          <View style={s.footer}>
            <Text style={s.footerTxt}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/auth/login')} disabled={loading}>
              <Text style={s.link}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:    { flex:1, backgroundColor:C.bg },
  scroll:  { flexGrow:1, padding:24, paddingBottom:48 },
  back:    { marginBottom:20 },
  backTxt: { fontSize:13, color:C.accent, fontWeight:'500' },
  header:  { marginBottom:28 },
  title:   { fontSize:26, fontWeight:'700', color:C.text, letterSpacing:-0.4 },
  sub:     { fontSize:13, color:C.dim, marginTop:4 },
  card:    { backgroundColor:C.surface, borderRadius:18, borderWidth:1, borderColor:C.border, padding:24 },
  field:   { marginBottom:16 },
  lbl:     { fontSize:13, fontWeight:'600', color:C.text, marginBottom:6 },
  input:   { backgroundColor:C.surface2, borderWidth:1, borderColor:C.border, borderRadius:10, padding:13, fontSize:15, color:C.text },
  disabled:{ opacity:0.6 },
  err:     { backgroundColor:C.errorBg, borderRadius:8, padding:12, marginBottom:12, borderWidth:1, borderColor:'rgba(220,38,38,0.2)' },
  errTxt:  { color:C.error, fontSize:13, lineHeight:18 },
  btn:     { backgroundColor:C.accent, borderRadius:12, paddingVertical:15, alignItems:'center', marginTop:4 },
  btnOff:  { opacity:0.5 },
  btnTxt:  { color:C.white, fontSize:15, fontWeight:'600' },
  footer:  { flexDirection:'row', justifyContent:'center', marginTop:24 },
  footerTxt:{ fontSize:13, color:C.dim },
  link:    { fontSize:13, color:C.accent, fontWeight:'600' },
});
