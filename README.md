# 🎵 Spotify Transcriptor

An optimized, production-grade Next.js application that seamlessly resolves Spotify episode metadata, locates unencrypted public audio distribution feeds, and generates stitched text transcripts using high-concurrency processing pipelines via OpenRouter.

---

## 🗺️ Interactive Architecture Flow

When you paste a link into the dashboard and click **Extract & Transcribe**, the engine executes a multi-stage background lifecycle to bypass standard platform DRM and size barriers:

```text
[ User Pastes Spotify URL ]
            │
            ▼
┌────────────────────────────────────────────────────────┐
│ 1. Metadata Scraping (oEmbed API)                      │
│ Parses 22-character ID ──► Fetches unauthenticated JSON│
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼ (Episode Title & Show Name Resolved)
┌────────────────────────────────────────────────────────┐
│ 2. Multi-Pass Feed Discovery (Apple iTunes Registry)    │
│ Searches Directory ──► Matches Title ──► Sniffs MP3 URL│
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼ (Pristine Audio Stream Resolved)
┌────────────────────────────────────────────────────────┐
│ 3. Automated Local Downsampling (FFmpeg Engine)        │
│ Downloads master audio ──► Cuts into 30-second fragments│
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼ (Generates Concurrent Disk Slices)
┌────────────────────────────────────────────────────────┐
│ 4. Pure JSON Payload Compilation (Base64 Serialization)│
│ Read Sync ──► buffer.toString('base64') ──► Format MP3 │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼ (Strict OpenRouter Schema Mapping)
┌────────────────────────────────────────────────────────┐
│ 5. Massive Async Worker Execution (OpenRouter Cloud)    │
│ 79+ Threads ──► openai/whisper-large-v3-turbo ──► Text │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼ (Zero Memory Failures / Zero Timeouts)
┌────────────────────────────────────────────────────────┐
│ 6. Text Stitching & Optional LLM Ad-Filtering          │
│ Joins indexes ──► gpt-4o-mini Sponsor Strip ──► UI Display│
└────────────────────────────────────────────────────────┘

```

---

## ⚡ Key Engineering Solutions Implemented

* **Runtime Boundary Invariance**: Traditional Node.js form engines (`Undici` runtime) append dynamic multi-part boundaries (`----formdata-undici-...`) that cloud proxy gateways reject with `HTTP 400`. This app entirely bypasses form-data layers by transmitting audio blocks via clean text objects.
* **Micro-Segment Ingestion**: High-fidelity podcast audio streams easily trip gateway payload firewalls. The backend programmatically splits incoming streams into **30-second fragments** using system-level `ffmpeg` binaries.
* **OpenRouter Schema Compliance**: Slices are translated into raw Base64 character strings and wrapped inside a strictly structured JSON block that satisfies the explicit upstream type signature perfectly:

```json
{
  "model": "openai/whisper-large-v3-turbo",
  "input_audio": {
    "data": "UklGRiQAA...",
    "format": "mp3"
  }
}

```

* **High-Concurrency Resilience**: Utilizes `Promise.all` to spin up dozens of isolated background workers simultaneously. Slices map cleanly across independent event loops with built-in exponential backoff loops to gracefully handle rate limit indicators without interrupting client response states.

---

## 🚀 Getting Started

### 1. Prerequisites

Ensure your system features a globally mapped, functional installation of `ffmpeg`:

```text
ffmpeg -version

```

### 2. Environment Setup

Create a `.env.local` file in your root project folder (automatically hidden from remote repository syncs via `.gitignore` rules):

```text
OPENROUTER_API_KEY=sk-or-v1-your-private-token-string

```

### 3. Initialize Dev Server

Install the required node modules and fire up your local environment:

```text
npm install
npm run dev

```

Open **`http://localhost:3000`** in your browser, paste your favorite track feed, and watch the asynchronous green checkmarks update your development log in real-time!