/**
 * useChunkRecorder — chunk-based audio recording with expo-audio
 *
 * Recording approach (stop/prepare/record cycle per chunk):
 *   1. prepareToRecordAsync()  → expo-audio creates a NEW temp file
 *   2. record()                → audio is written to that file
 *   3. [CHUNK_INTERVAL_MS passes]
 *   4. stop()                  → file is FINALIZED and closed, recorder.uri is valid
 *   5. Upload recorder.uri     → the complete, readable chunk file
 *   6. prepareToRecordAsync()  → creates NEXT new file (seamless)
 *   7. record()                → next chunk starts immediately
 *   8. Repeat until user taps Stop
 *
 * BACKGROUND / SCREEN-OFF STRATEGY:
 *   - activateKeepAwakeAsync() keeps the device awake during recording so
 *     the OS never suspends the JS thread or the native recorder.
 *   - shouldPlayInBackground + allowsBackgroundRecording are set as a
 *     secondary safety net.
 *   - If the app is somehow backgrounded despite keep-awake, the AppState
 *     handler runs a catch-up chunk cycle when the app returns.
 *   - Every chunk file is validated before upload — empty/corrupt files
 *     are silently skipped so the server never receives 0-second audio.
 *
 * OFFLINE HANDLING:
 *   If upload fails (no network): chunk file is copied to cacheDirectory,
 *   metadata saved to AsyncStorage queue, retried on network recovery.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import NetInfo from '@react-native-community/netinfo';
import { createMeeting, uploadChunk } from '../services/meetings';
import {
  enqueuePreCachedChunk, safeCopyChunkFile,
  drainQueueForMeeting, pendingCountForMeeting, readQueue,
} from '../services/chunkQueue';
import {
  showRecordingNotification,
  updateRecordingNotification,
  dismissRecordingNotification,
} from '../services/backgroundNotification';
import { CHUNK_INTERVAL_MS } from '../constants';

const KEEP_AWAKE_TAG = 'momai_recording';
const MIN_CHUNK_BYTES = 1000; // files smaller than this are considered empty/corrupt

export type RecordState =
  | 'idle'
  | 'recording'
  | 'cycling'
  | 'stopping'
  | 'draining'
  | 'merging'
  | 'done'
  | 'error';

export interface ChunkStatus {
  id:        number;
  status:    'uploading' | 'done' | 'failed' | 'queued';
  timestamp: string;
  sizeBytes?: number;
}

export interface MeetingForm {
  attendees:     string;
  context:       string;
  no_of_persons: number;
}

export function useChunkRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 500);

  const [state,        setState]        = useState<RecordState>('idle');
  const [elapsed,      setElapsed]      = useState(0);
  const [meetingId,    setMeetingId]    = useState<string | null>(null);
  const [chunks,       setChunks]       = useState<ChunkStatus[]>([]);
  const [statusMsg,    setStatusMsg]    = useState('');
  const [errorMsg,     setErrorMsg]     = useState('');
  const [isOnline,     setIsOnline]     = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef   = useRef(0);
  const chunkIdxRef    = useRef(0);
  const midRef         = useRef<string | null>(null);
  const isOnlineRef    = useRef(true);
  const isStoppingRef  = useRef(false);
  const lastCycleAtRef = useRef(0);
  const cyclingRef     = useRef(false); // prevents concurrent chunk cycles

  // Stable refs so effects/callbacks always see the latest function
  const runChunkCycleRef     = useRef<(() => Promise<void>) | undefined>(undefined);
  const scheduleNextCycleRef = useRef<(() => void) | undefined>(undefined);

  // ── On mount, resume any queued uploads from a previous session ─────────
  useEffect(() => {
    (async () => {
      try {
        const queue = await readQueue();
        if (!queue || queue.length === 0) return;

        const byMeeting: Record<string, { count: number; latestAt: number }> = {};
        for (const q of queue) {
          const prev = byMeeting[q.meetingId];
          if (!prev) {
            byMeeting[q.meetingId] = { count: 1, latestAt: q.addedAt };
          } else {
            prev.count += 1;
            if (q.addedAt > prev.latestAt) prev.latestAt = q.addedAt;
          }
        }

        const meetingIds = Object.keys(byMeeting);
        if (meetingIds.length === 0) return;

        const activeMid = meetingIds.reduce((a, b) =>
          byMeeting[a].latestAt >= byMeeting[b].latestAt ? a : b
        );

        midRef.current = activeMid;
        setMeetingId(activeMid);

        const pending = await pendingCountForMeeting(activeMid);
        setPendingCount(pending);
        if (pending === 0) return;

        if (!isOnlineRef.current) {
          setState('draining');
          setStatusMsg(
            `Waiting to upload ${pending} queued chunk${pending !== 1 ? 's' : ''} from your last recording...`,
          );
          return;
        }

        setState('draining');
        setStatusMsg(`Uploading ${pending} queued chunk${pending !== 1 ? 's' : ''} from your last recording...`);
        await drainQueueForMeeting(activeMid, (id, status) => {
          setChunks(prev => {
            const next = [...prev];
            const idx  = next.findIndex(c => c.id === id);
            if (idx >= 0) next[idx] = { ...next[idx], status };
            else next.push({ id, status, timestamp: new Date().toISOString() });
            return next;
          });
        });
        const remaining = await pendingCountForMeeting(activeMid);
        setPendingCount(remaining);

        if (remaining === 0) {
          setState('done');
          setStatusMsg('All chunks uploaded successfully.');
          console.log(`[recorder] resumed and uploaded all pending chunks, meeting=${activeMid}`);
        }
      } catch (e: any) {
        console.error('bootstrap pending queue:', e?.message);
        setErrorMsg(e?.message || 'Error resuming previous recording.');
        setState('error');
      }
    })();
  }, []);

  // ── Network monitoring ──────────────────────────────────────────────────
  useEffect(() => {
    NetInfo.fetch().then(s => {
      const online = s.isConnected === true && s.isInternetReachable !== false;
      setIsOnline(online);
      isOnlineRef.current = online;
    });

    const unsub = NetInfo.addEventListener(s => {
      const online     = s.isConnected === true && s.isInternetReachable !== false;
      const wasOffline = !isOnlineRef.current;
      isOnlineRef.current = online;
      setIsOnline(online);

      if (online && wasOffline && midRef.current) {
        console.log('[netinfo] back online — draining queue');
        const mid = midRef.current;
        drainQueueForMeeting(mid, (id, status) => {
          setChunks(prev => prev.map(c => c.id === id ? { ...c, status } : c));
        }).then(async ({ uploaded }) => {
          if (!mid) return;
          if (uploaded > 0) {
            const pending = await pendingCountForMeeting(mid);
            setPendingCount(pending);
          }

          if (isStoppingRef.current && mid) {
            const remaining = await pendingCountForMeeting(mid);
            if (remaining === 0) {
              setState('done');
              setStatusMsg('All chunks uploaded successfully.');
              console.log(`[recorder] all chunks uploaded after reconnect, meeting=${mid}`);
            }
          }
        });
      }
    });

    return () => {
      unsub();
      clearInterval(timerRef.current!);
      clearTimeout(chunkTimerRef.current!);
    };
  }, []);

  // ── Chunk cycle scheduler (stored in ref so AppState handler can use it)
  useEffect(() => {
    const scheduleNext = () => {
      clearTimeout(chunkTimerRef.current!);
      chunkTimerRef.current = setTimeout(async () => {
        if (!isStoppingRef.current) {
          await (runChunkCycleRef.current?.() ?? Promise.resolve());
          if (!isStoppingRef.current) scheduleNext();
        }
      }, CHUNK_INTERVAL_MS);
    };
    scheduleNextCycleRef.current = scheduleNext;
  }, []);

  // ── AppState: sync timer + catch-up chunk cycle after background ────────
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;
      if (isStoppingRef.current || !midRef.current) return;

      // Sync the elapsed timer to real wall-clock time
      if (startTimeRef.current > 0) {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }

      // If a chunk cycle is overdue, run a catch-up and reschedule
      const sinceLastCycle = Date.now() - lastCycleAtRef.current;
      if (lastCycleAtRef.current > 0 && sinceLastCycle >= CHUNK_INTERVAL_MS) {
        console.log(`[appstate] foreground, overdue ${sinceLastCycle}ms — catch-up cycle`);
        clearTimeout(chunkTimerRef.current!);
        (async () => {
          try {
            await (runChunkCycleRef.current?.() ?? Promise.resolve());
          } catch (e: any) {
            console.warn('[appstate] catch-up cycle error:', e?.message);
          }
          if (!isStoppingRef.current) {
            scheduleNextCycleRef.current?.();
          }
        })();
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, []);

  // ── Validate a file: exists and has real audio content ──────────────────
  const validateAudioFile = async (
    uri: string, label: string,
  ): Promise<{ valid: boolean; size: number }> => {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) {
        console.warn(`[${label}] file does not exist: ${uri}`);
        return { valid: false, size: 0 };
      }
      const size = (info as any).size ?? 0;
      if (size < MIN_CHUNK_BYTES) {
        console.warn(`[${label}] file too small (${size} bytes < ${MIN_CHUNK_BYTES}) — empty/corrupt, skipping`);
        return { valid: false, size };
      }
      return { valid: true, size };
    } catch (e: any) {
      console.warn(`[${label}] validation error:`, e?.message);
      return { valid: false, size: 0 };
    }
  };

  // ── Upload a chunk from its SAFE cached path ───────────────────────────
  const uploadSafeCachedChunk = useCallback(async (
    mid:       string,
    chunkId:   number,
    safePath:  string,
    timestamp: string,
  ) => {
    const { valid, size: sizeBytes } = await validateAudioFile(safePath, `chunk ${chunkId}`);
    if (!valid) return;

    console.log(`[chunk ${chunkId}] uploading ${sizeBytes} bytes from ${safePath}`);
    setChunks(prev => [...prev, { id: chunkId, status: 'uploading', timestamp, sizeBytes }]);

    const queueEntry = {
      meetingId: mid, chunkId, fileUri: safePath,
      cachedPath: safePath, timestamp, addedAt: Date.now(),
    };

    if (!isOnlineRef.current) {
      await enqueuePreCachedChunk(queueEntry);
      setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, status: 'queued' } : c));
      setPendingCount(n => n + 1);
      return;
    }

    try {
      await uploadChunk(mid, chunkId, safePath, timestamp);
      setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, status: 'done' } : c));
      await FileSystem.deleteAsync(safePath, { idempotent: true }).catch(() => {});
      console.log(`[chunk ${chunkId}] done`);
    } catch (e: any) {
      console.warn(`[chunk ${chunkId}] upload failed: ${e?.message} — queuing`);
      await enqueuePreCachedChunk(queueEntry);
      setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, status: 'queued' } : c));
      setPendingCount(n => n + 1);
    }
  }, []);

  // ── Chunk cycle: stop → validate → safe-copy → restart → upload ────────
  const runChunkCycle = useCallback(async () => {
    if (isStoppingRef.current || cyclingRef.current) return;
    const mid = midRef.current;
    if (!mid) return;

    cyclingRef.current = true;
    lastCycleAtRef.current = Date.now();
    setState(s => s === 'recording' ? 'cycling' : s);

    const timestamp = new Date().toISOString();

    try {
      await recorder.stop();
      const finishedUri = recorder.uri;

      let safePath: string | null = null;
      let chunkId:  number | null = null;

      if (finishedUri) {
        const { valid, size } = await validateAudioFile(finishedUri, 'cycle-check');
        if (valid) {
          chunkId  = chunkIdxRef.current++;
          safePath = await safeCopyChunkFile(mid, chunkId, finishedUri);
          console.log(`[chunk ${chunkId}] finalized ${size} bytes`);
        }
      } else {
        console.warn('[cycle] recorder.uri is null after stop');
      }

      // Restart recording regardless of file validity
      if (!isStoppingRef.current) {
        await recorder.prepareToRecordAsync();
        recorder.record();
        setState('recording');
      }

      // Upload valid chunk
      if (safePath && chunkId !== null) {
        await uploadSafeCachedChunk(mid, chunkId, safePath, timestamp);
        updateRecordingNotification(
          `Recording… chunk ${chunkId + 1} uploaded`,
        ).catch(() => {});
      }
    } catch (e: any) {
      console.error(`[cycle] error: ${e?.message}`);
      // Recorder may have been killed (e.g. by OS in background) — try to restart
      if (!isStoppingRef.current) {
        try {
          await recorder.prepareToRecordAsync();
          recorder.record();
          setState('recording');
          console.log('[cycle] recorder restarted after error');
        } catch (recoverErr: any) {
          console.error('[cycle] restart failed:', recoverErr?.message);
          setErrorMsg('Recording interrupted: ' + recoverErr?.message);
          setState('error');
          deactivateKeepAwake(KEEP_AWAKE_TAG);
          await dismissRecordingNotification();
        }
      }
    } finally {
      cyclingRef.current = false;
    }
  }, [recorder, uploadSafeCachedChunk]);

  // Keep a stable ref to the latest function
  useEffect(() => { runChunkCycleRef.current = runChunkCycle; }, [runChunkCycle]);

  // ── START RECORDING ─────────────────────────────────────────────────────
  const startRecording = async (form: MeetingForm) => {
    setErrorMsg('');
    setChunks([]);
    setPendingCount(0);
    chunkIdxRef.current   = 0;
    isStoppingRef.current = false;
    lastCycleAtRef.current = 0;
    cyclingRef.current     = false;

    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setErrorMsg('Microphone permission denied.\nGo to Settings → Privacy → Microphone and enable it.');
        return;
      }

      // Keep the device awake so the OS never suspends recording
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);

      // Audio mode — background flags serve as fallback if keep-awake fails
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        shouldPlayInBackground: true,
        allowsBackgroundRecording: true,
      });

      setStatusMsg('Creating meeting on server...');
      const attendeeList = form.attendees
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const mid = await createMeeting({
        attendees:     attendeeList,
        context:       form.context.trim(),
        no_of_persons: form.no_of_persons,
      });

      midRef.current = mid;
      setMeetingId(mid);
      setStatusMsg('');

      await recorder.prepareToRecordAsync();
      recorder.record();
      setState('recording');
      setElapsed(0);
      startTimeRef.current = Date.now();

      await showRecordingNotification();

      // Elapsed clock — derived from wall-clock time, always accurate
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Start the repeating chunk cycle
      lastCycleAtRef.current = Date.now();
      scheduleNextCycleRef.current?.();

      console.log(`[recorder] started, meeting=${mid}`);
    } catch (e: any) {
      console.error('startRecording:', e);
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false }).catch(() => {});
      await dismissRecordingNotification();
      setErrorMsg(e?.message || 'Could not start recording.');
      setState('error');
    }
  };

  // ── STOP RECORDING ──────────────────────────────────────────────────────
  const stopRecording = async () => {
    isStoppingRef.current = true;

    clearTimeout(chunkTimerRef.current!);
    clearInterval(timerRef.current!);
    chunkTimerRef.current = null;
    timerRef.current = null;

    // Freeze elapsed display at the exact stop moment
    if (startTimeRef.current > 0) {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }

    setState('stopping');
    setStatusMsg('Uploading final chunk...');

    try {
      const mid = midRef.current;
      if (!mid) throw new Error('No meeting ID.');

      const timestamp = new Date().toISOString();

      await recorder.stop();
      const finalUri = recorder.uri;

      deactivateKeepAwake(KEEP_AWAKE_TAG);
      await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false }).catch(() => {});
      await dismissRecordingNotification();

      // Validate and upload the final chunk
      if (finalUri) {
        const { valid, size } = await validateAudioFile(finalUri, 'final-chunk');
        if (valid) {
          const chunkId  = chunkIdxRef.current++;
          const safePath = await safeCopyChunkFile(mid, chunkId, finalUri);
          console.log(`[chunk ${chunkId}] final chunk ${size} bytes`);
          await uploadSafeCachedChunk(mid, chunkId, safePath, timestamp);
        } else {
          console.warn('[stop] final chunk file is empty/invalid — skipping');
        }
      }

      const totalChunks = chunkIdxRef.current;

      // Offline — leave chunks in queue for later
      if (!isOnlineRef.current) {
        const pending = await pendingCountForMeeting(mid);
        setPendingCount(pending);
        setState('draining');
        setStatusMsg(
          pending > 0
            ? `Waiting to upload ${pending} queued chunk${pending !== 1 ? 's' : ''} when back online...`
            : 'Waiting for connection to finish upload...',
        );
        console.log(`[recorder] stopped while offline, meeting=${mid}, pending=${pending}`);
        return;
      }

      // Drain any offline-queued chunks
      const pending = await pendingCountForMeeting(mid);
      if (pending > 0) {
        setState('draining');
        setStatusMsg(`Uploading ${pending} offline chunk${pending !== 1 ? 's' : ''}...`);
        await drainQueueForMeeting(mid, (id, status) => {
          setChunks(prev => {
            const next = [...prev];
            const idx  = next.findIndex(c => c.id === id);
            if (idx >= 0) next[idx] = { ...next[idx], status };
            else next.push({ id, status, timestamp: new Date().toISOString() });
            return next;
          });
        });
        setPendingCount(await pendingCountForMeeting(mid));
      }

      setState('done');
      setStatusMsg(`All ${totalChunks} chunks uploaded successfully.`);
      console.log(`[recorder] upload complete, meeting=${mid}, totalChunks=${totalChunks}`);
    } catch (e: any) {
      console.error('stopRecording:', e);
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      await dismissRecordingNotification();
      setErrorMsg(e?.message || 'Error stopping recording.');
      setState('error');
    }
  };

  // ── RESET ───────────────────────────────────────────────────────────────
  const reset = () => {
    isStoppingRef.current  = false;
    cyclingRef.current     = false;
    setState('idle');
    setElapsed(0);
    setMeetingId(null);
    setChunks([]);
    setStatusMsg('');
    setErrorMsg('');
    setPendingCount(0);
    midRef.current         = null;
    chunkIdxRef.current    = 0;
    startTimeRef.current   = 0;
    lastCycleAtRef.current = 0;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
  };

  return {
    state, elapsed, meetingId, chunks,
    statusMsg, errorMsg, isOnline,
    pendingCount,
    doneCount:   chunks.filter(c => c.status === 'done').length,
    failedCount: chunks.filter(c => c.status === 'queued').length,
    isRecording: recState.isRecording || state === 'cycling',
    startRecording, stopRecording, reset,
  };
}
