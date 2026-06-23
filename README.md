# 🎙️ Tranzkript — Spotify Podcast Transcriptor

> Paste a Spotify link. Get a pristine, searchable transcript. Zero bloat, maximum speed, pennies per episode.

---

## 🚀 Overview

**Tranzkript** is a lean, no-nonsense web application that transforms any public Spotify podcast episode into a clean, downloadable transcript. Built on Next.js 14, it stream-stitches through Spotify's oEmbed API, the iTunes Search directory, RSS feed resolution, and OpenRouter's Whisper large-v3-turbo engine — all inside a **sub-512MB RAM footprint** with aggressive disk-streaming to keep memory usage near zero.

**Why it's different:**

- **No audio files stored in RAM** — every byte streams directly to disk via Node.js pipe-to-filesystem.
- **No expensive GPU required** — transcription runs on OpenRouter's serverless Whisper endpoint at $0.000333 per 30-second chunk.
- **No bloated UI** — single-page hero with real-time NDJSON streaming status, no unnecessary loading skeletons.
- **Ad-filtering mode** — optional LLM pass (GPT-4o-mini) strips sponsor reads and promotional content from the final transcript.

---

## 🛠️ Architecture Workflow

                  ┌──────────────────────────────────────┐
                  │        User pastes Spotify URL       │
                  │   (e.g., /episode/22_alphanumeric)   │
                  └────────────────┬─────────────────────┘
                                   │ POST /api/transcribe
                                   ▼
          ┌────────────────────────────────────────────────┐
          │  Step A:  oEmbed Metadata Retrieval            │
          │                                                │
          │  Extracts: episodeTitle + showName             │
          │  Splits dash-delimited titles (e.g.,           │
          │  "The Future of AI – Lex Fridman Podcast")     │
          └────────────────────┬───────────────────────────┘
                               ▼
          ┌────────────────────────────────────────────────┐
          │  Step B:  iTunes Search API — Multi-Pass       │
          │                                                │
          │  Pass 1:  Episode-level search                 │
          │  [itunes.apple.com/search?entity=podcastEpisode](https://itunes.apple.com/search?entity=podcastEpisode) │
          │    └─ Scores results by word-overlap ratio     │
          │    └─ Filters known false-positive collections │
          │    └─ Returns DIRECT_AUDIO_URL if available ───┼── ⚡ Shortcut
          │                                                │
          │  Pass 2:  Show-level fallback                  │
          │  [itunes.apple.com/search?entity=podcast](https://itunes.apple.com/search?entity=podcast)        │
          │    └─ Matches by normalized show name          │
          │    └─ Extracts RSS feedUrl from result         │
          └────────────────────┬───────────────────────────┘
                               ▼ (feedUrl or direct audio)
          ┌────────────────────────────────────────────────┐
          │  Step C:  RSS Feed Parsing & Audio Download    │
          │                                                │
          │  If no direct URL:                             │
          │    └─ Parse RSS XML via rss-parser             │
          │    └─ Match episode title (sanitized compare)  │
          │                                                │
          │  ┌────────────────────────────────────────┐    │
          │  │  🧠 STREAM TO DISK  (zero RAM)         │    │
          │  │    → pipe(fs.createWriteStream)        │    │
          │  │      → /tmp/st-XXXXX/input.mp3         │    │
          │  └────────────────────────────────────────┘    │
          └────────────────────┬───────────────────────────┘
                               ▼
          ┌────────────────────────────────────────────────┐
          │  Step D:  ffmpeg Chunk Slicing (on disk)       │
          │                                                │
          │  ffmpeg -i input.mp3 -f segment                │
          │    -segment_time 30 -c copy -map 0:a           │
          │    → /tmp/st-XXXXX/chunk_001.mp3               │
          └────────────────────┬───────────────────────────┘
                               ▼
          ┌────────────────────────────────────────────────┐
          │  Step E:  Pooled Transcription Workers         │
          │                                                │
          │  ⚙️  MAX_CONCURRENT_TRANSCRIBERS = 3           │
          │  Batch-processes chunks through OpenRouter     │
          │  Whisper large-v3-turbo with exponential       │
          │  backoff and 3x retry safety limits.           │
          └────────────────────┬───────────────────────────┘
                               ▼ (raw transcript string)
          ┌────────────────────────────────────────────────┐
          │  Step F:  (Optional) Ad Filtering & NDJSON     │
          │                                                │
          │  Stitches text, passes through GPT-4o-mini     │
          │  to remove sponsors, and returns final payload │
          └────────────────────────────────────────────────┘

---

## 📦 Core System Features

| Feature | Primary Mechanism | Technical Resolution |
| :--- | :--- | :--- |
| **Memory Isolation** | `pipe-to-filesystem` | Downloads raw data straight to a distinct request workspace inside `/tmp/` using `Readable.fromWeb(res.body)`, keeping container heap usage under 200MB. |
| **Concurrency Cap** | `MAX_CONCURRENT_TRANSCRIBERS = 3` | Handles audio decoding batch requests in chunks of 3 via a sliding-window array loop to guarantee server stability on thin tiers. |
| **False-Positive Guard** | Array Scoring Matrix | Checks incoming iTunes payloads against a local collection filter and skips known ambiguous name duplicates using a `wordOverlapRatio` validator. |
| **Dynamic Routing** | Token Extraction Helper | Extracts unique episode signatures directly from the URL path via regex and sanitizes punctuation strings before talking to Apple catalogs. |
| **Streaming UI** | NDJSON Transform Pipelines | Writes progression lines chunk-by-chunk over a native `TransformStream` layer so the interface updates state values in real-time without polling hooks. |