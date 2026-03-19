import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Animated, Easing, Image,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useChunkRecorder, type ChunkStatus, type MeetingForm } from '../src/hooks/useChunkRecorder';
import { logout } from '../src/services/auth';
import { C, CHUNK_INTERVAL_MS } from '../src/constants';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtTime = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const chunkColor = (status: ChunkStatus['status']) => {
  switch (status) {
    case 'done':      return C.success;
    case 'uploading': return C.accent;
    case 'queued':    return C.warn;
    case 'failed':    return C.error;
    default:          return C.muted;
  }
};
const chunkLabel = (status: ChunkStatus['status']) => {
  switch (status) {
    case 'done':      return '✓';
    case 'uploading': return '↑';
    case 'queued':    return '⏸';
    case 'failed':    return '✕';
    default:          return '·';
  }
};

// ── Animated waveform ─────────────────────────────────────────────────────────
function Waveform({ active }: { active: boolean }) {
  const anims = useRef<Animated.Value[]>(
    Array.from({ length: 20 }, () => new Animated.Value(0.12))
  ).current;
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    loopsRef.current.forEach(l => l.stop());
    loopsRef.current = [];

    if (!active) {
      Animated.parallel(
        anims.map(a => Animated.timing(a, { toValue: 0.12, duration: 300, useNativeDriver: false }))
      ).start();
      return;
    }

    anims.forEach((anim, i) => {
      const peak = 0.3 + Math.random() * 0.65;
      const dur  = 240 + Math.random() * 360;
      const loop = Animated.loop(Animated.sequence([
        Animated.delay(i * 28),
        Animated.timing(anim, { toValue: peak, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0.08 + Math.random() * 0.1, duration: dur * 0.8, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ]));
      loop.start();
      loopsRef.current.push(loop);
    });
    return () => loopsRef.current.forEach(l => l.stop());
  }, [active]);

  return (
    <View style={wv.wrap}>
      {anims.map((anim, i) => (
        <Animated.View key={i} style={[wv.bar, {
          height:          anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: active ? C.accent : C.border,
          opacity:         active ? 0.85 : 0.25,
        }]} />
      ))}
    </View>
  );
}
const wv = StyleSheet.create({
  wrap: { height: 56, flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingHorizontal: 8, backgroundColor: C.surface2, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 20, paddingBottom: 4, paddingTop: 4 },
  bar:  { flex: 1, borderRadius: 2, minHeight: 3 },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function RecordScreen() {
  const ins        = useSafeAreaInsets();
  const [loggedOut, setLoggedOut] = useState(false);

  const {
    state, elapsed, meetingId, chunks,
    statusMsg, errorMsg, isOnline,
    pendingCount, doneCount,
    isRecording,
    startRecording, stopRecording, reset,
  } = useChunkRecorder();

  if (loggedOut) return <Redirect href="/auth/login" />;

  const isBusy = state === 'stopping' || state === 'draining';

  const handleStart = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const defaultForm: MeetingForm = {
      attendees:     'raw',
      context:       'meeting',
      no_of_persons: 1,
    };
    await startRecording(defaultForm);
  };

  const handleStop = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await stopRecording();
  };

  const handleNewRecording = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    reset();
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await logout();
          setLoggedOut(true);
        }
      },
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={[s.root, { paddingTop: ins.top }]}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">

        {/* ── Header ── */}
        <View style={s.header}>
          <Image source={require('../assets/smart-mom.png')} style={s.headerLogo} resizeMode="contain" />
          <View style={s.headerRight}>
            <View style={[s.netPill, { backgroundColor: isOnline ? `${C.success}18` : `${C.warn}18` }]}>
              <View style={[s.netDot, { backgroundColor: isOnline ? C.success : C.warn }]} />
              <Text style={[s.netTxt, { color: isOnline ? C.success : C.warn }]}>
                {isOnline ? 'Online' : 'Offline'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/settings")} style={s.settingsBtn}>
              <Text style={s.settingsTxt}>⚙</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout} style={s.logoutBtn}>
              <Text style={s.logoutTxt}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Main card ── */}
        <View style={s.card}>

          {/* ── IDLE: minimal start UI ── */}
          {state === 'idle' && (
            <View style={s.idleWrap}>
              <Waveform active={false} />
              {!!errorMsg && (
                <View style={s.errBox}>
                  <Text style={s.errTxt}>⚠  {errorMsg}</Text>
                </View>
              )}
              <TouchableOpacity
                style={s.startCircle}
                onPress={handleStart}
                activeOpacity={0.85}
              >
                <View style={s.startInner}>
                  <View style={s.startDot} />
                </View>
              </TouchableOpacity>
              <Text style={s.idleLabel}>Start Recording</Text>
            </View>
          )}

          {/* ── RECORDING + PROCESSING states ── */}
          {state !== 'idle' && (
            <>
              {/* Eyebrow status */}
              <View style={s.eyebrow}>
                <View style={[s.eyebrowDot, isRecording && s.eyebrowDotLive]} />
                <Text style={s.eyebrowTxt}>
                  {state === 'recording' && 'Recording in progress'}
                  {state === 'stopping'  && 'Finishing up recording...'}
                  {state === 'draining'  && 'Finishing up recording...'}
                  {state === 'merging'   && 'Finishing uploads...'}
                  {state === 'done'      && 'Recording complete ✓'}
                  {state === 'error'     && 'Recording error'}
                </Text>
              </View>

              {/* Waveform */}
              <Waveform active={isRecording} />

              {/* Timer */}
              <View style={s.timerWrap}>
                <Text style={[s.timer, isRecording && s.timerLive]}>{fmtTime(elapsed)}</Text>
                <Text style={s.timerSub}>{isRecording ? 'Recording' : 'Duration'}</Text>
              </View>

              {/* Chunk upload summary */}
              <View style={s.chunkSummary}>
                <Text style={s.chunkSummaryTitle}>Recording upload status</Text>
                <Text style={s.chunkSummaryLine}>
                  {doneCount} chunk{doneCount !== 1 ? 's' : ''} uploaded
                  {pendingCount > 0 ? `  ·  ${pendingCount} pending` : ''}
                </Text>
                {pendingCount > 0 && !isOnline && (
                  <Text style={s.chunkSummaryHint}>Pending chunks will upload automatically when you are back online.</Text>
                )}
              </View>

              {/* Meeting ID */}
              {meetingId && (
                <View style={s.midRow}>
                  <Text style={s.midLbl}>MEETING ID  </Text>
                  <Text style={s.midVal} numberOfLines={1}>{meetingId}</Text>
                </View>
              )}

              {/* Controls */}
              <View style={s.controls}>
                {state === 'recording' && (
                  <TouchableOpacity style={s.stopBtn} onPress={handleStop} activeOpacity={0.85}>
                    <View style={s.stopInner}>
                      <View style={s.stopSq} />
                    </View>
                    <Text style={s.stopTxt}>Stop Recording</Text>
                  </TouchableOpacity>
                )}

                {state === 'done' && (
                  <View style={s.doneWrap}>
                    <Text style={s.doneEmoji}>✅</Text>
                    <Text style={s.doneTitle}>Upload complete!</Text>
                    <Text style={s.doneDesc}>
                      {doneCount} chunk{doneCount !== 1 ? 's' : ''} uploaded successfully.{'\n'}
                      You can merge them manually when ready.
                    </Text>
                    <TouchableOpacity style={s.newBtn} onPress={handleNewRecording} activeOpacity={0.85}>
                      <Text style={s.newBtnTxt}>↺  New Recording</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {state === 'error' && (
                  <TouchableOpacity style={s.retryBtn} onPress={handleNewRecording} activeOpacity={0.85}>
                    <Text style={s.retryTxt}>↺  Try Again</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: C.bg },
  content:     { padding: 20, paddingBottom: 48 },

  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  headerLogo:  { width: 120, height: 34 },
  brandSub:    { fontSize: 12, color: C.muted, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  netPill:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  netDot:      { width: 6, height: 6, borderRadius: 3 },
  netTxt:      { fontSize: 11, fontWeight: '600' },
  logoutBtn:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  logoutTxt:   { fontSize: 12, color: C.dim, fontWeight: '500' },

  card:        { backgroundColor: C.surface, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 20, marginBottom: 16 },

  idleWrap:    { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  startCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: C.live, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 18, elevation: 6 },
  startInner:  { width: 86, height: 86, borderRadius: 43, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  startDot:    { width: 30, height: 30, borderRadius: 15, backgroundColor: C.white },
  idleLabel:   { marginTop: 18, fontSize: 15, fontWeight: '600', color: C.dim },

  eyebrow:     { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 16 },
  eyebrowDot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: C.border },
  eyebrowDotLive: { backgroundColor: C.live },
  eyebrowTxt:  { fontSize: 12, color: C.muted, letterSpacing: 0.2 },

  timerWrap:   { alignItems: 'center', marginBottom: 20 },
  timer:       { fontSize: 62, fontWeight: '300', color: C.muted, letterSpacing: -3, fontVariant: ['tabular-nums'] as any },
  timerLive:   { color: C.text },
  timerSub:    { fontSize: 10, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 },

  chunkSummary:{ backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  chunkSummaryTitle: { fontSize: 11, fontWeight: '600', color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  chunkSummaryLine:  { fontSize: 13, color: C.text },
  chunkSummaryHint:  { fontSize: 11, color: C.muted, marginTop: 4 },

  summaryBox:  { backgroundColor: C.surface2, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 14, overflow: 'hidden' },
  summaryRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  summaryLbl:  { fontSize: 9, fontWeight: '700', color: C.muted, letterSpacing: 1, width: 72 },
  summaryVal:  { flex: 1, fontSize: 13, color: C.text },

  chunkBox:    { backgroundColor: C.surface2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 14 },
  chunkHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  chunkTitle:  { fontSize: 12, fontWeight: '600', color: C.dim },
  chunkOfflineNote: { fontSize: 10, color: C.warn },
  chunkGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chunkPill:   { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1.5 },
  chunkLbl:    { fontSize: 13, fontWeight: '700' },
  chunkId:     { fontSize: 10, fontWeight: '600' },
  legend:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:   { width: 6, height: 6, borderRadius: 3 },
  legendTxt:   { fontSize: 10, color: C.muted },

  statusRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 14 },
  statusTxt:   { fontSize: 13, color: C.dim, flex: 1 },

  errBox:      { backgroundColor: C.errorBg, borderRadius: 10, padding: 13, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(220,38,38,0.2)' },
  errTxt:      { color: C.error, fontSize: 13, lineHeight: 19 },

  midRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface2, borderRadius: 8, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  midLbl:      { fontSize: 9, color: C.muted, letterSpacing: 1, fontWeight: '600' },
  midVal:      { flex: 1, fontSize: 11, color: C.dim },

  controls:    { gap: 12 },
  stopBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, borderRadius: 14, paddingVertical: 16, borderWidth: 1.5, borderColor: C.border, gap: 10 },
  stopInner:   { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' } as any,
  stopSq:      { width: 12, height: 12, borderRadius: 3, backgroundColor: C.text },
  stopTxt:     { color: C.text, fontSize: 16, fontWeight: '600' },

  busyRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  busyTxt:     { fontSize: 14, color: C.dim },

  doneWrap:    { alignItems: 'center', paddingVertical: 8 },
  doneEmoji:   { fontSize: 48, marginBottom: 14 },
  doneTitle:   { fontSize: 18, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 8 },
  doneDesc:    { fontSize: 13, color: C.dim, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  newBtn:      { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 13 },
  newBtnTxt:   { color: C.white, fontWeight: '600', fontSize: 15 },

  retryBtn:    { backgroundColor: C.surface2, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  retryTxt:    { color: C.text, fontSize: 15, fontWeight: '600' },

  infoCard:    { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 18 },
  infoTitle:   { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 12 },
  infoLine:    { fontSize: 12, color: C.dim, lineHeight: 23 },
  settingsBtn: { padding: 8, borderRadius: 8, borderWidth:1, borderColor: C.border, backgroundColor: C.surface, marginRight: 4 },
  settingsTxt: { fontSize: 16, color: C.dim },
});
