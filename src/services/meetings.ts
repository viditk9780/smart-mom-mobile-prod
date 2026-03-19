import * as FileSystem from 'expo-file-system/legacy';
import { getBackendUrl } from '../constants';
import { authFetch, getToken, parseDetail } from './auth';

const friendlyError = (status: number, detail: string, fallback: string): string => {
  if (detail && detail !== fallback) return detail;
  switch (status) {
    case 502: return 'Server unreachable (502). Tunnel expired — restart it and update the URL in Settings.';
    case 503: return 'Server unavailable (503). Check your backend is running.';
    case 504: return 'Gateway timeout (504). Server is too slow.';
    case 401: return 'Session expired — please sign in again.';
    case 422: return detail || 'Validation error — check the fields.';
    default:  return fallback;
  }
};

export const createMeeting = async (params: {
  attendees:     string[];
  context:       string;
  no_of_persons: number;
}): Promise<string> => {
  const meetingId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const url = getBackendUrl();
  const body = {
    meeting_id:    meetingId,
    attendees:     params.attendees,
    context:       params.context,
    no_of_persons: params.no_of_persons,
    date_time:     new Date().toISOString(),
    audio_s3_key:  'pending',
    audio_state:   'chunked',
  };
  const res  = await authFetch(`${url}/api/v1/meetings/`, { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = parseDetail(data.detail, '');
    throw new Error(friendlyError(res.status, detail, `Create meeting failed (${res.status})`));
  }
  const mid = data?.data?.meeting_id || data?.meeting_id || meetingId;
  console.log(`[meeting] created: ${mid}`);
  return mid;
};

export const uploadChunk = async (
  meetingId: string, chunkId: number, fileUri: string, timestamp: string,
): Promise<void> => {
  const backendUrl = getBackendUrl();
  const token      = await getToken();
  const endpoint   = `${backendUrl}/api/v1/meetings/${meetingId}/chunks`;

  const result = await FileSystem.uploadAsync(endpoint, fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'audio',
    mimeType: 'audio/mp4',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    parameters: {
      chunk_id:  String(chunkId),
      timestamp: timestamp,
    },
  });

  if (result.status < 200 || result.status >= 300) {
    let detail = '';
    try {
      const d = JSON.parse(result.body);
      detail = parseDetail(d.detail, '');
    } catch {}
    throw new Error(friendlyError(result.status, detail, `Chunk ${chunkId} upload failed (${result.status})`));
  }
  console.log(`[chunk] uploaded id=${chunkId} meeting=${meetingId} status=${result.status}`);
};

export const mergeChunks = async (meetingId: string, totalChunks?: number): Promise<void> => {
  const url = getBackendUrl();
  const body = totalChunks != null ? JSON.stringify({ total_chunks: totalChunks }) : undefined;
  const res = await authFetch(`${url}/api/v1/meetings/${meetingId}/merge-chunks`, {
    method: 'POST',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {}),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(friendlyError(res.status, parseDetail(d.detail,''), `Merge failed (${res.status})`));
  }
  console.log(`[merge] complete for meeting=${meetingId}, total_chunks=${totalChunks}`);
};
