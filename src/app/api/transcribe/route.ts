import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface ScrapedMetadata {
  episodeTitle: string;
  showName: string;
}

interface RssEpisode {
  title: string;
  enclosureUrl: string | null;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface SuccessResponse {
  metadata: ScrapedMetadata;
  rssFeedUrl: string | null;
  transcript: string;
  segments: TranscriptSegment[];
  adFiltered: boolean;
}

interface ErrorResponse {
  error: string;
  detail?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Maximum binary size before we split into chunks (4 MB — Base64 expansion + safety margin). */
const CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

/** Duration of each audio chunk in seconds (3 minutes — keeps Base64 payload under 8 MB). */
const CHUNK_DURATION_SECONDS = 30;

/** Build the OpenAI-compatible client pointed at OpenRouter. */
function createOpenRouterClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. Set it in your .env.local file."
    );
  }
  return new OpenAI({
    baseURL: OPENROUTER_BASE,
    apiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/spotify-transcriptor",
      "X-Title": "Spotify Transcriptor",
    },
    maxRetries: 2,
  });
}

/** Regex to extract the 22-character alphanumeric Spotify episode ID from a URL. */
const EPISODE_ID_RE = /\/episode\/([a-zA-Z0-9]{22})/;

/**
 * Aggressively strip symbols, numbers, and attribution patterns so the
 * iTunes Search API receives a clean alphabetical query.
 *   Input:  "Vikings #495 – Ragnar the Berserkers of Valhalla - Lars Brownworth"
 *   Output: "Vikings Ragnar the Berserkers of Valhalla Lars Brownworth"
 */
function cleanSearchQuery(title: string): string {
  return title
    // Remove content inside brackets, parentheses, braces.
    .replace(/[\[\(\{].*?[\]\)\}]/g, " ")
    // Remove all non-alphabetic characters (#tags, numbers, dashes, punctuation).
    .replace(/[^a-zA-Z\s]+/g, " ")
    // Collapse runs of whitespace.
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch metadata via Spotify's public oEmbed endpoint (open, unauthenticated, pure JSON). */
async function scrapeSpotifyEpisode(
  url: string
): Promise<ScrapedMetadata | null> {
  // 1) Extract the 22-character episode ID from the user's URL.
  const idMatch = url.match(EPISODE_ID_RE);
  if (!idMatch) {
    throw new Error(
      "Could not extract a valid episode ID from the URL. " +
      "Expected format: https://open.spotify.com/episode/22charId"
    );
  }

  // 2) Fetch Spotify's public oEmbed endpoint — no auth, no bot-blocking.
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  const res = await fetch(oembedUrl, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Spotify oEmbed returned HTTP ${res.status}. The episode ID may be invalid.`
    );
  }

  const data: any = await res.json();
  console.log("-> oEmbed raw response:", JSON.stringify(data, null, 2));

  // 3) Split the oEmbed title to extract episode + show name.
  //    Typical format: "Episode Name – Show Name"
  const rawTitle: string = data?.title?.trim() ?? "";
  const authorName: string = data?.author_name?.trim() ?? "";

  if (!rawTitle) {
    console.log("-> Scraped Title: (none) — oEmbed returned no title");
    return null;
  }

  let episodeTitle: string;
  let showName: string;

  // Guard: if the title starts with an index prefix (Hebrew "פרק", "Ep", "Episode"),
  // do NOT split — pass the full title as the search term.
  const hasIndexPrefix = /^(?:פרק\s|Ep[\s.]|Episode\s)/i.test(rawTitle);

  // Only split on a clean dash delimiter when no index prefix is present.
  const dashMatch = rawTitle.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dashMatch && !hasIndexPrefix) {
    episodeTitle = dashMatch[1].trim();
    showName = dashMatch[2].trim();
    console.log("-> Split by dash — episode:", episodeTitle, "| show:", showName);
  } else {
    // No valid delimiter — keep the full title intact for iTunes searching.
    episodeTitle = rawTitle;
    showName = authorName || "Unknown Show";
    console.log("-> Using full title — episode:", episodeTitle, "| show hint:", showName);
  }

  if (!showName) {
    showName = "Unknown Show";
  }

  console.log("-> Final — episodeTitle:", episodeTitle, "| showName:", showName);
  return { episodeTitle, showName };
}

type RssFeedResult =
  | { found: true; feedUrl: string; feedTitle: string }
  | { found: false; reason: "empty-results" | "no-match" | "unknown-show" };

/** Multi-pass iTunes search: episode-title first, then fall back to show-name lookup. */
async function findRssFeed(
  showName: string,
  episodeTitle?: string
): Promise<RssFeedResult> {
  // --- Pass 1: Search by the full oEmbed title (podcastEpisode may carry feedUrl). ---
  if (episodeTitle) {
    const cleanedEp = cleanSearchQuery(episodeTitle);
    console.log("-> iTunes Episode Query:", cleanedEp);

    const epRes = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        cleanedEp
      )}&entity=podcastEpisode&limit=5`,
      { headers: { Accept: "application/json" } }
    );

    if (epRes.ok) {
      const epData: any = await epRes.json();
      console.log("-> iTunes Episode Results:", epData.results?.length);
      if (epData.results?.length) {
        // Return the first result that carries a feedUrl (regardless of entity type).
        for (const r of epData.results) {
          if (r.feedUrl) {
            console.log("-> Found feedUrl via episode search:", r.feedUrl);
            return {
              found: true,
              feedUrl: r.feedUrl,
              feedTitle: r.collectionName ?? "",
            };
          }
        }
      }
    }
  }

  // Guard: if showName is still the fallback string or blank, do NOT search for it.
  const isUnknownShow = !showName || /^unknown\s*show$/i.test(showName);
  if (isUnknownShow) {
    console.log("-> Show name is unknown — skipping fallback search.");
    return { found: false, reason: "unknown-show" };
  }

  // --- Pass 2: Fall back to show-name search (entity=podcast). ---
  const cleanedName = cleanSearchQuery(showName);
  console.log("-> iTunes Show Query:", cleanedName);

  const showRes = await fetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(
      cleanedName
    )}&entity=podcast&limit=5`,
    { headers: { Accept: "application/json" } }
  );

  if (!showRes.ok) return { found: false, reason: "no-match" };

  const data: any = await showRes.json();
  console.log("-> iTunes Show Results:", data.results?.length);
  if (!data.results?.length)
    return { found: false, reason: "empty-results" };

  // Prefer a result whose collectionName closely matches.
  const normalizedTarget = cleanedName.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const r of data.results) {
    const candidate = (r.collectionName ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (r.feedUrl && candidate.includes(normalizedTarget)) {
      return { found: true, feedUrl: r.feedUrl, feedTitle: r.collectionName };
    }
  }

  // Fallback: return the first result that has a feedUrl.
  const first = data.results.find((r: any) => r.feedUrl);
  if (first)
    return { found: true, feedUrl: first.feedUrl, feedTitle: first.collectionName };

  return { found: false, reason: "no-match" };
}

/** Normalize title: lowercase, strip punctuation/emojis, collapse whitespace. */
function sanitizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract a numeric episode identifier (e.g. "#42", "Episode 13", "Ep. 7"). */
function extractEpisodeNumber(title: string): string | null {
  const m = title.match(/(?:#|ep(?:isode)?\.?\s*)(\d+)/i);
  return m ? m[1] : null;
}

/** Compute word-overlap ratio between two pre-sanitized strings. */
function wordOverlapRatio(a: string, b: string): number {
  const wa = a.split(/\s+/).filter(Boolean);
  const wb = b.split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  const common = wa.filter((w) => wb.includes(w)).length;
  return common / Math.max(wa.length, wb.length);
}

/** Parse the RSS XML and locate the episode with a matching title. */
async function findEpisodeInFeed(
  feedUrl: string,
  episodeTitle: string
): Promise<RssEpisode | null> {
  const parser = new Parser({
    timeout: 15_000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SpotifyTranscriptor/1.0; +https://github.com)",
    },
  });

  const feed = await parser.parseURL(feedUrl);
  if (!feed.items?.length) return null;

  const sanitizedTarget = sanitizeTitle(episodeTitle);
  const targetEpNum = extractEpisodeNumber(episodeTitle);

  let bestFallback: { item: any; score: number } | null = null;

  for (const item of feed.items) {
    const itemTitle = [item.title, (item as any)["itunes:title"]]
      .filter(Boolean)
      .join(" ") || "";
    const sanitizedItem = sanitizeTitle(itemTitle);

    // 1) Primary: inclusion check on sanitized strings.
    if (
      sanitizedItem.includes(sanitizedTarget) ||
      sanitizedTarget.includes(sanitizedItem)
    ) {
      const enclosureUrl = item.enclosure?.url ?? item.link ?? null;
      if (enclosureUrl) {
        return { title: itemTitle, enclosureUrl };
      }
    }

    // 2) Fallback: matching episode number (e.g. "#42", "Episode 13").
    if (targetEpNum) {
      const itemEpNum = extractEpisodeNumber(itemTitle);
      if (itemEpNum && itemEpNum === targetEpNum) {
        const enclosureUrl = item.enclosure?.url ?? item.link ?? null;
        if (enclosureUrl) {
          return { title: itemTitle, enclosureUrl };
        }
      }
    }

    // 3) Track best word-overlap for ultimate fallback.
    //    Tie-breaking: higher score wins; same score → newer isoDate wins.
    const score = wordOverlapRatio(sanitizedTarget, sanitizedItem);
    if (
      score > 0 &&
      (!bestFallback ||
        score > bestFallback.score ||
        (score === bestFallback.score &&
          (item.isoDate ?? "") > (bestFallback.item.isoDate ?? "")))
    ) {
      bestFallback = { item, score };
    }
  }

  // Ultimate fallback: return the best match above the threshold.
  if (bestFallback && bestFallback.score >= 0.45) {
    const enclosureUrl =
      bestFallback.item.enclosure?.url ?? bestFallback.item.link ?? null;
    if (enclosureUrl) {
      return {
        title: bestFallback.item.title ?? episodeTitle,
        enclosureUrl,
      };
    }
  }

  // Log sample titles for debugging when no match is found.
  if (feed.items?.length) {
    console.log(
      "-> Sample RSS Titles in Feed:",
      feed.items.slice(0, 3).map((i: any) => i.title)
    );
  }

  return null;
}

/** Download an MP3 and return it as a Buffer. */
async function downloadAudio(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to download audio (HTTP ${res.status}). The audio file may be behind a login wall.`
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  if (!arrayBuffer.byteLength) {
    throw new Error("Downloaded audio file is empty.");
  }

  const buf = Buffer.from(arrayBuffer);
  console.log("-> Downloaded audio:", `${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  return buf;
}

/* ------------------------------------------------------------------ */
/*  Chunking & Retry Helpers                                           */
/* ------------------------------------------------------------------ */

/** Split an audio buffer into 3-minute MP3 chunks via ffmpeg, returning file paths. */
async function splitAudioIntoChunks(
  inputBuffer: Buffer
): Promise<{ chunkPaths: string[]; tmpDir: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "st-"));
  const inputPath = path.join(tmpDir, "input.mp3");

  await fs.writeFile(inputPath, inputBuffer);

  return new Promise<{ chunkPaths: string[]; tmpDir: string }>((resolve, reject) => {
    const outputPattern = path.join(tmpDir, "chunk_%03d.mp3");

    ffmpeg(inputPath)
      .outputOptions([
        "-f", "segment",
        "-segment_time", String(CHUNK_DURATION_SECONDS),
        "-reset_timestamps", "1",
        "-c", "copy",
        "-map", "0:a",
      ])
      .output(outputPattern)
      .on("end", async () => {
        try {
          const files = await fs.readdir(tmpDir);
          const chunkFiles = files.filter((f) => f.startsWith("chunk_")).sort();
          const chunkPaths = chunkFiles.map((f) => path.join(tmpDir, f));
          resolve({ chunkPaths, tmpDir });
        } catch (err) {
          reject(err);
        }
      })
      .on("error", (err) => {
        fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
        reject(err);
      })
      .run();
  });
}

/** Transcribe a single chunk with retry; returns the text or a warning marker. */
async function transcribeChunk(
  openai: any, // We will use standard fetch instead of the client object here
  chunkPath: string,
  chunkIndex: number,
  totalChunks: number
): Promise<string> {
  const label = `Chunk ${chunkIndex}/${totalChunks}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // 1. Read the raw chunk binary into a node buffer
      const buffer = fsSync.readFileSync(chunkPath);

      // 2. Map it to a clean base64 data URI string scheme
      const rawBase64 = buffer.toString("base64");

      console.log(`-> Sending ${label} to OpenRouter via pure JSON Base64 string...`);

      // 3. Post to the transcript endpoint as standard JSON text
      const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/whisper-large-v3-turbo",
          // 🛑 Switch from flat 'file' property to OpenRouter's nested 'input_audio' signature block
          input_audio: {
            format: "mp3",
            data: rawBase64,
          }
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData?.error?.message || `HTTP ${response.status}`);
      }

      const text = (responseData.text || "").trim();
      console.log(`-> ✅ ${label} transcribed (${text.length} chars)`);
      return text;
    } catch (err: any) {
      console.log(`-> ❌ ${label} attempt ${attempt}/3 failed: ${err.message || err}`);
      if (attempt < 3) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  console.log(`-> ⚠️ ${label} failed after 3 attempts — inserting warning marker`);
  return `[⚠️ Audio segment unavailable — ${label}]`;
}

/** Transcribe audio via OpenRouter Whisper, returning full text + segments. */
async function transcribeAudio(
  openai: OpenAI,
  audioBuffer: Buffer
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const audioFile = new File([new Uint8Array(audioBuffer)], "audio.mp3", {
    type: "audio/mpeg",
  });

  const response = await openai.audio.transcriptions.create({
    model: "openai/whisper-large-v3-turbo",
    file: audioFile,
    response_format: "verbose_json",
    language: "en",
  });

  // With verbose_json the SDK returns an object that has .text and .segments.
  const text = typeof response.text === "string" ? response.text : "";

  const segments: TranscriptSegment[] = (
    response as any
  ).segments?.map((seg: any) => ({
    start: Math.round(seg.start * 100) / 100,
    end: Math.round(seg.end * 100) / 100,
    text: seg.text?.trim() ?? "",
  })) ?? [{ start: 0, end: 0, text }];

  return { text, segments };
}

/** Pass the transcript through an LLM to strip sponsor/ad segments. */
async function filterAds(
  openai: OpenAI,
  rawTranscript: string,
  segments: TranscriptSegment[]
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const response = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: [
          "You are a podcast transcript editor. Your task is to remove sponsor reads,",
          "advertisements, promotional codes, and paid endorsements from the transcript.",
          "Rules:",
          "- Remove any segment that is a sponsor mention, ad read, or promo code pitch.",
          "- Keep all actual show content intact — host discussions, interviews, etc.",
          "- Do NOT rewrite or paraphrase anything; remove only the ad segments.",
          "- If a sentence is partly ad and partly content, keep the content portion.",
          "- Return ONLY the cleaned transcript, no commentary or explanations.",
        ].join("\n"),
      },
      {
        role: "user",
        content: rawTranscript,
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  });

  const cleaned = response.choices?.[0]?.message?.content?.trim();

  if (!cleaned) {
    // If the LLM returned nothing unexpected, return the original.
    return { text: rawTranscript, segments };
  }

  // Map the cleaned text back to segments heuristically — for display we
  // preserve the original segments and note which ones were likely ads by
  // checking which segment text appears in the cleaned version.
  const cleanedSegments = segments
    .filter((seg) => cleaned.includes(seg.text))
    .map((seg) => ({ ...seg }));

  // If filtering gutted everything (unlikely), return original with a note.
  if (!cleanedSegments.length) {
    return { text: rawTranscript, segments };
  }

  return { text: cleaned, segments: cleanedSegments };
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(
  req: NextRequest
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const body = await req.json();
    const spotifyUrl: string | undefined = body.spotifyUrl;
    const filterAdsFlag: boolean = body.filterAds === true;

    // --- Validate input ---
    if (!spotifyUrl || typeof spotifyUrl !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'spotifyUrl' in request body." },
        { status: 400 }
      );
    }

    const trimmedUrl = spotifyUrl.trim();
    if (
      !trimmedUrl.startsWith("https://open.spotify.com/") &&
      !trimmedUrl.startsWith("http://open.spotify.com/")
    ) {
      return NextResponse.json(
        { error: "Please provide a valid open.spotify.com URL." },
        { status: 400 }
      );
    }

    // --- Step A: Scrape metadata ---
    const metadata = await scrapeSpotifyEpisode(trimmedUrl);
    if (!metadata) {
      return NextResponse.json(
        {
          error:
            "Could not find episode metadata on that Spotify page. " +
            "Make sure it's a public podcast episode URL " +
            "(e.g. https://open.spotify.com/episode/...).",
        },
        { status: 400 }
      );
    }

    // --- Step B: Multi-pass RSS feed resolution ---
    let rssFeedUrl: string | null = null;
    const rssResult = await findRssFeed(metadata.showName, metadata.episodeTitle);
    if (rssResult.found) {
      rssFeedUrl = rssResult.feedUrl;
      console.log("-> Parsed RSS URL:", rssFeedUrl);
    } else if (rssResult.reason === "empty-results") {
      return NextResponse.json(
        {
          error:
            "Show could not be resolved via public directories " +
            "(Potential Spotify Exclusive).",
        },
        { status: 404 }
      );
    } else if (rssResult.reason === "unknown-show") {
      return NextResponse.json(
        {
          error:
            "This episode could not be located in public directories " +
            "and is likely a Spotify Exclusive show.",
        },
        { status: 404 }
      );
    }

    // --- Step C: Match episode in RSS feed & download audio ---
    let audioBuffer: Buffer | null = null;
    let episodeFound = false;

    if (rssFeedUrl) {
      try {
        const episode = await findEpisodeInFeed(
          rssFeedUrl,
          metadata.episodeTitle
        );
        if (episode?.enclosureUrl) {
          episodeFound = true;
          audioBuffer = await downloadAudio(episode.enclosureUrl);
        }
      } catch (err: any) {
        // RSS parsing or download failed — fall through gracefully.
        rssFeedUrl = null;
      }
    }

    if (!audioBuffer) {
      const isExclusive =
        rssFeedUrl === null && !episodeFound
          ? " The show may be a Spotify Exclusive without a public RSS feed."
          : "";

      return NextResponse.json(
        {
          error:
            "Could not locate or download the audio for this episode." +
            isExclusive,
          detail:
            "Spotify Exclusive shows often don't syndicate via public RSS." +
            " Try requesting the episode directly from the show's official RSS feed.",
        },
        { status: 404 }
      );
    }

    // --- Step E: OpenRouter Transcription (with auto-chunking for large files) ---
    const openai = createOpenRouterClient();

    let rawText: string;
    let segments: TranscriptSegment[];

    if (audioBuffer.length <= CHUNK_SIZE_BYTES) {
      // Small enough to send in one shot — original path.
      const result = await transcribeAudio(openai, audioBuffer);
      rawText = result.text;
      segments = result.segments;
      console.log("-> Single transcription done:", rawText.length, "chars");
    } else {
      // Large file — split into 3-minute chunks and transcribe concurrently.
      const mb = (audioBuffer.length / 1024 / 1024).toFixed(1);
      console.log(`-> Audio is ${mb} MB — splitting into 3-minute chunks...`);

      const { chunkPaths, tmpDir } = await splitAudioIntoChunks(audioBuffer);
      const total = chunkPaths.length;
      console.log(`-> Split into ${total} chunk(s) for concurrent transcription`);

      const transcripts: string[] = await Promise.all(
        chunkPaths.map((chunkPath, i) => {
          const index = i + 1;
          console.log(`-> Processing Chunk ${index}/${total}...`);
          return transcribeChunk(openai, chunkPath, index, total);
        })
      );

      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });

      rawText = transcripts.join("\n\n");
      segments = []; // Chunked mode loses per-word segment timing granularity.
      console.log("-> Stitched transcript:", rawText.length, "chars across", total, "chunks");
    }

    // --- Step F: Optional ad filtering ---
    let finalText = rawText;
    let finalSegments = segments;
    let adFiltered = false;

    if (filterAdsFlag) {
      try {
        const filtered = await filterAds(openai, rawText, segments);
        finalText = filtered.text;
        finalSegments = filtered.segments;
        adFiltered = true;
      } catch {
        // If the ad-filter call fails, serve the raw transcript.
        adFiltered = false;
      }
    }

    return NextResponse.json({
      metadata,
      rssFeedUrl,
      transcript: finalText,
      segments: finalSegments,
      adFiltered,
    });
  } catch (err: any) {
    const message = err?.message ?? "An unexpected error occurred.";
    // Don't leak stack traces in production.
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}