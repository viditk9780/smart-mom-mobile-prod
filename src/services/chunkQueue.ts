/**
 * Offline chunk queue — mirrors the web app's IndexedDB approach.
 *
 * When a chunk upload fails due to no connectivity:
 *   1. The audio file is already saved at a URI by expo-audio
 *   2. We persist the metadata to AsyncStorage so it survives app restarts
 *   3. On network recovery (detected by NetInfo), the queue is drained
 *
 * Queue entry shape:
 *   { meetingId, chunkId, fileUri, timestamp, addedAt }
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { CHUNK_QUEUE_KEY } from '../constants';
import { uploadChunk } from './meetings';

export interface QueuedChunk {
  meetingId:  string;
  chunkId:    number;
  fileUri:    string;    // local file:// URI
  cachedPath: string;    // permanent copy in cacheDirectory
  timestamp:  string;
  addedAt:    number;    // Date.now() for ordering
}

// ── Read the full queue ───────────────────────────────────────────────────────
export const readQueue = async (): Promise<QueuedChunk[]> => {
  try {
    const raw = await AsyncStorage.getItem(CHUNK_QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedChunk[];
  } catch {
    return [];
  }
};

// ── Save the full queue ───────────────────────────────────────────────────────
const saveQueue = async (queue: QueuedChunk[]): Promise<void> => {
  await AsyncStorage.setItem(CHUNK_QUEUE_KEY, JSON.stringify(queue));
};

// ── Ensure the chunk cache directory exists ───────────────────────────────────
export const CHUNK_CACHE_DIR = FileSystem.cacheDirectory + 'momai_chunks/';

export const ensureChunkCacheDir = async (): Promise<void> => {
  const dirInfo = await FileSystem.getInfoAsync(CHUNK_CACHE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CHUNK_CACHE_DIR, { intermediates: true });
  }
};

// ── Copy a recorder file to a stable cache path ──────────────────────────────
// MUST be called immediately after recorder.stop() and BEFORE
// recorder.prepareToRecordAsync() so the source file is still valid.
export const safeCopyChunkFile = async (
  meetingId: string, chunkId: number, sourceUri: string,
): Promise<string> => {
  await ensureChunkCacheDir();
  const safePath = `${CHUNK_CACHE_DIR}${meetingId}_${chunkId}.m4a`;
  await FileSystem.copyAsync({ from: sourceUri, to: safePath });
  return safePath;
};

// ── Enqueue a chunk that is already safely cached ────────────────────────────
// The file at cachedPath is guaranteed to be a complete, valid audio file.
export const enqueuePreCachedChunk = async (entry: QueuedChunk): Promise<void> => {
  try {
    const queue = await readQueue();
    queue.push(entry);
    await saveQueue(queue);
    console.log(`[queue] enqueued pre-cached chunk ${entry.chunkId} for meeting ${entry.meetingId}`);
  } catch (e: any) {
    console.warn('[queue] enqueue failed:', e?.message);
  }
};

// ── Enqueue one chunk (legacy — copies file then enqueues) ───────────────────
export const enqueueChunk = async (entry: Omit<QueuedChunk, 'cachedPath'>): Promise<void> => {
  try {
    const cachedPath = await safeCopyChunkFile(entry.meetingId, entry.chunkId, entry.fileUri);
    await enqueuePreCachedChunk({ ...entry, cachedPath });
  } catch (e: any) {
    console.warn('[queue] enqueue failed:', e?.message);
  }
};

// ── Remove one chunk from the queue ──────────────────────────────────────────
export const dequeueChunk = async (meetingId: string, chunkId: number): Promise<void> => {
  try {
    const queue   = await readQueue();
    const entry   = queue.find(c => c.meetingId === meetingId && c.chunkId === chunkId);
    const updated = queue.filter(c => !(c.meetingId === meetingId && c.chunkId === chunkId));
    await saveQueue(updated);

    // Delete the cached file
    if (entry?.cachedPath) {
      await FileSystem.deleteAsync(entry.cachedPath, { idempotent: true }).catch(() => {});
    }
  } catch (e: any) {
    console.warn('[queue] dequeue failed:', e?.message);
  }
};

// ── Drain the queue for a specific meeting ────────────────────────────────────
// Called on network recovery or after stopRecording()
// Returns { uploaded, failed }
export const drainQueueForMeeting = async (
  meetingId: string,
  onProgress?: (chunkId: number, status: 'uploading' | 'done' | 'failed') => void,
): Promise<{ uploaded: number; failed: number }> => {
  const queue = await readQueue();
  const mine  = queue
    .filter(c => c.meetingId === meetingId)
    .sort((a, b) => a.chunkId - b.chunkId);  // strictly ordered

  if (mine.length === 0) return { uploaded: 0, failed: 0 };

  let uploaded = 0;
  let failed   = 0;

  for (const entry of mine) {
    onProgress?.(entry.chunkId, 'uploading');
    try {
      await uploadChunk(entry.meetingId, entry.chunkId, entry.cachedPath, entry.timestamp);
      await dequeueChunk(entry.meetingId, entry.chunkId);
      onProgress?.(entry.chunkId, 'done');
      uploaded++;
    } catch (e: any) {
      console.warn(`[queue] retry failed chunk=${entry.chunkId}:`, e?.message);
      onProgress?.(entry.chunkId, 'failed');
      failed++;
    }
  }

  console.log(`[queue] drain complete uploaded=${uploaded} failed=${failed}`);
  return { uploaded, failed };
};

// ── Drain ALL pending chunks across ALL meetings ──────────────────────────────
// Used when the app comes back online
export const drainAllQueues = async (): Promise<void> => {
  const queue = await readQueue();
  if (queue.length === 0) return;

  // Group by meeting
  const byMeeting: Record<string, QueuedChunk[]> = {};
  for (const c of queue) {
    if (!byMeeting[c.meetingId]) byMeeting[c.meetingId] = [];
    byMeeting[c.meetingId].push(c);
  }

  for (const [meetingId, chunks] of Object.entries(byMeeting)) {
    const ordered = chunks.sort((a, b) => a.chunkId - b.chunkId);
    for (const entry of ordered) {
      try {
        await uploadChunk(entry.meetingId, entry.chunkId, entry.cachedPath, entry.timestamp);
        await dequeueChunk(entry.meetingId, entry.chunkId);
        console.log(`[queue] background upload done chunk=${entry.chunkId}`);
      } catch {
        // Keep in queue — will retry on next network event
      }
    }
  }
};

// ── Count pending chunks for a meeting ───────────────────────────────────────
export const pendingCountForMeeting = async (meetingId: string): Promise<number> => {
  const queue = await readQueue();
  return queue.filter(c => c.meetingId === meetingId).length;
};
