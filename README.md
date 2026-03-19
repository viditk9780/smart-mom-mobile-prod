# Smart MoM Mobile

The offline-first **mobile recorder** for Smart MoM — capture meetings on the go, upload resilient audio chunks, and sync seamlessly with the Smart MoM backend.

[![Expo](https://img.shields.io/badge/client-Expo%2054-000020?style=flat-square&logo=expo&logoColor=white)](https://expo.dev)
[![React Native](https://img.shields.io/badge/mobile-React%20Native%200.81-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![expo-audio](https://img.shields.io/badge/audio-expo--audio-007808?style=flat-square&logo=react&logoColor=white)](https://docs.expo.dev/versions/latest/sdk/audio/)
[![Secure Store](https://img.shields.io/badge/auth-Expo%20Secure%20Store-FF6F00?style=flat-square&logo=expo&logoColor=white)](https://docs.expo.dev/versions/latest/sdk/securestore/)
[![Async Storage](https://img.shields.io/badge/offline-Async%20Storage-FFCA28?style=flat-square&logo=react&logoColor=black)](https://react-native-async-storage.github.io/async-storage/)
[![FastAPI Backend](https://img.shields.io/badge/backend-FastAPI%20Smart%20MoM-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![MongoDB](https://img.shields.io/badge/database-MongoDB%20Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/atlas)
[![Redis](https://img.shields.io/badge/broker-Redis%207-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![OpenAI](https://img.shields.io/badge/AI-GPT--4o-412991?style=flat-square&logo=openai&logoColor=white)](https://openai.com)
[![Qdrant](https://img.shields.io/badge/vector--db-Qdrant-FF4B4B?style=flat-square&logo=qdrant&logoColor=white)](https://qdrant.tech)
[![AWS S3](https://img.shields.io/badge/storage-AWS%20S3-FF9900?style=flat-square&logo=amazon-s3&logoColor=white)](https://aws.amazon.com/s3)
[![FFmpeg](https://img.shields.io/badge/audio-ffmpeg-007808?style=flat-square&logo=ffmpeg&logoColor=white)](https://ffmpeg.org)
[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

> This repo is the **mobile client**. It is designed to work with the Smart MoM backend (FastAPI + MongoDB + Redis + Qdrant + S3) described in the main Smart MoM project.

[Architecture](#architecture-overview) | [Features](#features) | [Technology Stack](#technology-stack) | [Project Structure](#project-structure) | [Setup & Running](#setup--running) | [Recording Flow](#recording-flow) | [Backend Integration](#backend-integration) | [Known Limitations](#known-limitations)

---

**App name:** Smart MoM (mobile)  
**Stack:** Expo · React Native · TypeScript · expo-audio · AsyncStorage · Secure Store · NetInfo  
**Works with:** FastAPI Smart MoM backend · MongoDB Atlas · Redis · Qdrant · AWS S3 · ffmpeg

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                Smart MoM Mobile                 │
│  Expo / React Native app                        │
│  - Login / Register                             │
│  - Meeting metadata form                        │
│  - Chunk-based recording via expo-audio         │
│  - Offline chunk queue (AsyncStorage + FS)      │
│  - Background-safe recording + notifications    │
└──────────────────────────────┬──────────────────┘
                               │ HTTPS (JWT auth)
                               ▼
┌──────────────────────────────────────────────────┐
│              Smart MoM Backend (FastAPI)        │
│  /auth/login, /auth/register, /auth/logout      │
│  /api/v1/meetings/                              │
│  /api/v1/meetings/{id}/chunks                   │
│  /api/v1/meetings/{id}/merge-chunks            │
└─────────────┬───────────────┬──────────────────┘
              │               │
              ▼               ▼
          MongoDB          Redis
          (meetings,       (JWT
           users)          blacklist)
              │
              ▼
          Qdrant + OpenAI + S3 + ffmpeg
          (transcription, RAG, audio storage)
```

The mobile app focuses solely on **reliable recording and upload**. All transcription, summarisation, RAG, and chat features live in the backend / web dashboard.

---

## Features

- **Email + password authentication**
  - Secure token storage via Expo Secure Store
  - Friendly, backend-aware error messages (invalid creds, expired tunnel, backend down)

- **Chunk-based audio recording (expo-audio)**
  - High-quality MP4/AAC recording
  - Fixed chunk interval (`CHUNK_INTERVAL_MS`, default 30s)
  - Each chunk finalised and uploaded as **self-contained MP4** (ffmpeg-ready on backend)

- **Offline-first uploads**
  - If upload fails (no network / timeout), chunks are:
    - Copied into app cache directory
    - Enqueued in AsyncStorage with metadata
    - Automatically retried when network comes back
  - Queue is resumed on app start so no recorded audio is lost accidentally

- **Background & screen-off support**
  - `activateKeepAwakeAsync` to keep device awake during recording
  - Audio mode configured with `allowsBackgroundRecording` and `shouldPlayInBackground`
  - Catch-up chunk cycle if OS suspends JS and app returns to foreground
  - Persistent notification while recording (Android)

- **Meeting metadata**
  - Capture attendees, context, and number of participants along with audio
  - Creates meeting in backend **before** recording starts

- **Backend URL configuration**
  - Runtime-configurable backend URL stored in AsyncStorage
  - Defaults to `EXPO_PUBLIC_BACKEND_URL` (or `http://localhost:8000`)

---

## Technology Stack

### Mobile Client

| Component           | Technology / Package                      |
|--------------------|--------------------------------------------|
| Framework          | Expo SDK 54 (managed)                      |
| Runtime            | React Native 0.81, React 19                |
| Language           | TypeScript 5                               |
| Navigation         | Expo Router 6                              |
| Audio Recording    | `expo-audio` (high quality MP4/AAC)        |
| Auth Token Storage | `expo-secure-store`                        |
| Offline Queue      | AsyncStorage + `expo-file-system/legacy`   |
| Network Status     | `@react-native-community/netinfo`          |
| Background         | `expo-keep-awake`, notifications helper    |
| UI                 | React Native core components + custom theme|

### Backend (expected)

The app assumes the Smart MoM FastAPI backend with:

- `/auth/*` endpoints (JWT-based)
- `/api/v1/meetings/*` meeting + chunk endpoints
- MongoDB Atlas, Redis, Qdrant, OpenAI, AWS S3, ffmpeg

---

## Project Structure

```bash
momai-v7/
├── app/
│   ├── _layout.tsx          # Expo Router root layout
│   ├── index.tsx            # Auth gate → /record or /auth/login
│   ├── auth/
│   │   ├── login.tsx        # Login screen (email/password)
│   │   └── register.tsx     # Registration screen
│   ├── record.tsx           # Recording screen (uses useChunkRecorder)
│   └── settings.tsx         # Backend URL / settings screen
│
├── src/
│   ├── constants/
│   │   └── index.ts         # Colors, backend URL helpers, chunk interval
│   ├── hooks/
│   │   └── useChunkRecorder.ts
│   │                          # Core recording + chunk cycle + offline queue
│   └── services/
│       ├── auth.ts          # login / register / logout, authFetch wrapper
│       ├── meetings.ts      # createMeeting, uploadChunk, mergeChunks
│       ├── chunkQueue.ts    # AsyncStorage-backed queue of offline chunks
│       └── backgroundNotification.ts
│                              # Recording notification helpers
│
├── assets/
│   ├── Mom.png
│   └── smart-mom.png        # App icon & splash
│
├── app.json                 # Expo app config (permissions, icons, bundle IDs)
├── babel.config.js
├── metro.config.js
├── package.json
├── tsconfig.json
└── eas.json                 # EAS build profiles (if using Expo Application Services)
```

---

## Setup & Running

### Prerequisites

- Node.js 20+
- npm 10+ or Yarn
- Expo CLI (`npm install -g expo-cli` optional)
- A running **Smart MoM backend** (FastAPI) or tunnel URL (Cloudflare, ngrok, etc.)

> For local backend development, make sure the FastAPI service exposes:  
> - `/auth/login`  
> - `/auth/register`  
> - `/auth/logout`  
> - `/api/v1/meetings/`  
> - `/api/v1/meetings/{id}/chunks`  
> - `/api/v1/meetings/{id}/merge-chunks`

### Environment Variables

The mobile app reads the backend URL from a public Expo env:

```bash
# .env (or .env.development for EAS)
EXPO_PUBLIC_BACKEND_URL="http://localhost:8000"
```

- **`EXPO_PUBLIC_BACKEND_URL`**:
  - Default backend URL used on first launch.
  - Can be overridden at runtime inside the app (Settings), persisted via AsyncStorage.

> Only `EXPO_PUBLIC_*` variables are available on the client. Non-`EXPO_PUBLIC_` keys will not be accessible.

### Install & Run (Expo Go)

```bash
# 1. Install dependencies
npm install
# or
yarn install

# 2. (Optional) create .env for backend URL
echo EXPO_PUBLIC_BACKEND_URL="http://localhost:8000" > .env

# 3. Start the Expo dev server
npm run start
# or
npx expo start --offline
```

- Scan the QR code with the **Expo Go** app (iOS/Android) or run on a simulator:
  - Android: `npm run android`
  - iOS: `npm run ios`

> When testing against a local backend from a device, ensure:  
> - Device and backend machine are on the same network  
> - `EXPO_PUBLIC_BACKEND_URL` is set to your machine IP (e.g. `http://192.168.0.10:8000`)  
> - Any tunnel (Cloudflare, ngrok) URLs are reachable from the device

### Build (EAS)

If you use Expo Application Services:

```bash
# 1. Configure eas.json (already present)
# 2. Login to Expo
npx expo login

# 3. Configure project
npx expo prebuild # if you need to customize native code (optional)

# 4. Trigger a build
npx expo build:android
# or
npx expo build:ios
```

Refer to `eas.json` for pre-configured build profiles.

---

## Recording Flow

### Chunk-Based Recording

The recording lifecycle is implemented in `useChunkRecorder`:

1. **Start recording**
   - Request microphone permission via `requestRecordingPermissionsAsync`
   - `activateKeepAwakeAsync` to prevent sleep
   - Configure audio mode using `setAudioModeAsync`:
     - `playsInSilentMode: true`
     - `allowsRecording: true`
     - `shouldPlayInBackground: true`
     - `allowsBackgroundRecording: true`
   - Call `createMeeting` on the backend with:
     - `meeting_id` (client-generated `rec_<timestamp>_<rand>`)
     - `attendees[]`, `context`, `no_of_persons`
     - `audio_state = "chunked"` (backend knows audio is chunk-based)
   - Start `expo-audio` recorder using `prepareToRecordAsync()` + `record()`
   - Start wall-clock-based elapsed timer

2. **Chunk cycle (every `CHUNK_INTERVAL_MS`, default 30s)**

   For each cycle:

   - `recorder.stop()` finalises the current file
   - Validate the file via `FileSystem.getInfoAsync`:
     - Must exist and be bigger than `MIN_CHUNK_BYTES` (default 1000 bytes)
   - Copy file into a **safe cached path** (one per meeting/chunk) via `safeCopyChunkFile`
   - Restart recording **immediately**:
     - `prepareToRecordAsync()` → `record()`
   - Upload the safe cached file via `uploadChunk`:
     - `POST /api/v1/meetings/{id}/chunks`
     - `multipart/form-data`, field `audio`, MIME `audio/mp4`
     - Parameters: `chunk_id`, `timestamp`

3. **Stop recording**

   - Stop timers and chunk scheduler
   - Stop recorder and validate the **final chunk**
   - Upload final chunk (or queue if offline)
   - Drain any queued chunks for the meeting if online
   - Leave `audio_state` as `chunked` for the backend to later call `/merge-chunks`

### Offline & Retry Queue

If chunk upload fails:

- Chunk is copied to a stable cache location
- Entry is enqueued in AsyncStorage via `enqueuePreCachedChunk`
- UI shows status as `queued`, and `pendingCount` increases
- On:
  - App start, or
  - Network back-online event

  the app calls `drainQueueForMeeting` to retry all queued uploads.

The queue persists across app restarts, ensuring that no valid recorded audio is lost.

### Background & Screen-Off Behaviour

- `activateKeepAwakeAsync('momai_recording')` is used to keep the app awake while recording.
- `allowsBackgroundRecording` is set to protect against incidental backgrounding.
- When app returns to foreground:
  - Elapsed timer is resynchronised using wall-clock time.
  - If a chunk cycle is overdue, a **catch-up cycle** is executed immediately.
- Android uses a foreground notification while recording (via `backgroundNotification` helpers).

---

## Backend Integration

### Auth Endpoints

From `src/services/auth.ts`:

| Method | Path             | Description                     |
|--------|------------------|---------------------------------|
| `POST` | `/auth/login`    | Email + password login         |
| `POST` | `/auth/register` | Account registration           |
| `POST` | `/auth/logout`   | Blacklist current JWT (best-effort) |

- Tokens are stored with `expo-secure-store` under key `auth_token`.
- `authFetch` adds `Authorization: Bearer <token>` and handles:
  - Timeouts (default 15s)
  - Offline / unreachable server
  - Friendly error mapping for 401/403/422/502/503/504

### Meetings & Chunks Endpoints

From `src/services/meetings.ts`:

| Method | Path                                         | Description                                      |
|--------|----------------------------------------------|--------------------------------------------------|
| `POST` | `/api/v1/meetings/`                         | Create a new meeting (metadata only)            |
| `POST` | `/api/v1/meetings/{id}/chunks`              | Upload a single audio chunk (multipart)         |
| `POST` | `/api/v1/meetings/{id}/merge-chunks`        | (Optional) Trigger merge after upload complete  |

> The backend is responsible for:  
> - Detecting mobile MP4 chunks  
> - Using ffmpeg concat demuxer to merge them correctly  
> - Updating `audio_state` from `"chunked"` → `"ready"`  
> - Handing off to transcription + RAG pipelines

### Configuring the Backend URL

The app reads and persists the backend URL via `src/constants/index.ts`:

- **Default**: `DEFAULT_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'`
- **Runtime override**:
  - Stored under key `momai_backend_url` in AsyncStorage
  - `initBackendUrl()` loads saved value on app start
  - `setBackendUrl()` updates both in-memory `_runtimeUrl` and AsyncStorage

In UI:

- The **Settings** screen allows users to:
  - View the current backend URL
  - Update it for tunnels / staging / production
  - Show hints if the tunnel (e.g. Cloudflare) has expired (based on HTTP 502/503/504 codes)

---

## Known Limitations

1. **No in-app transcription or summaries**  
   The mobile app only records and uploads audio. All transcription, summarisation, and chat features are handled by the backend and web dashboard.

2. **Backend contract required**  
   The app assumes a Smart MoM-compatible backend (FastAPI routes and response shapes). Using a different backend requires matching endpoints or adapting the service layer.

3. **No in-app playback**  
   Playback / viewing of meetings is expected via the web dashboard. This app does not currently provide audio playback UI.

4. **Single backend at a time**  
   The app targets one backend URL at a time (with runtime override). Multi-environment switching is manual via Settings.

---

## License

This project is licensed under the **MIT License**. See `LICENSE` for details.

