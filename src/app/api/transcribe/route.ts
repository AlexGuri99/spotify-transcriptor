import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { Readable } from "stream";
import { finished } from "stream/promises";

/* ------------------------------------------------------------------ */
/* Types                                                             */
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
/* Configs & Constants                                               */
/* ------------------------------------------------------------------ */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Maximum binary size before we split into chunks (4 MB — Base64 expansion + safety margin). */
const CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

/** Duration of each audio chunk in seconds (30 seconds — keeps Base64 payload small). */
const CHUNK_DURATION_SECONDS = 30;

/** 🔒 CRITICAL CONCURRENCY LIMIT: Process only 3 at a time to stay under 512MB RAM on Render */
const MAX_CONCURRENT_TRANSCRIBERS = 3; 

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

/** Fetch metadata via Spotify's public oEmbed endpoint. */
async function scrapeSpotifyEpisode(url: string): Promise<ScrapedMetadata | null> {
  const idMatch = url.match(EPISODE_ID_RE);
  if (!idMatch) {
    throw new Error(
      "Could not extract a valid episode ID from the URL. Expected format: /episode/[22_chars]"
    );
  }

  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  const res = await fetch(oembedUrl, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Spotify oEmbed returned HTTP ${res.status}.`);
  }

  const data: any = await res.json();
  console.log("-> oEmbed raw response:", JSON.stringify(data, null, 2));

  const rawTitle: string = data?.title?.trim() ?? "";
  const authorName: string = data?.author_name?.trim() ?? "";

  if (!rawTitle) return null;

  let episodeTitle: string;
  let showName: string;

  const hasIndexPrefix = /^(?:פרק\s|Ep[\s.]|Episode\s)/i.test(rawTitle);
  const dashMatch = rawTitle.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  
  if (dashMatch && !hasIndexPrefix) {
    episodeTitle = dashMatch[1].trim();
    showName = dashMatch[2].trim();
    console.log("-> Split by dash — episode:", episodeTitle, "| show:", showName);
  } else {
    episodeTitle = rawTitle;
    showName = authorName || "Unknown Show";
    console.log("-> Using full title — episode:", episodeTitle, "| show hint:", showName);
  }

  if (!showName) showName = "Unknown Show";

  console.log("-> Final — episodeTitle:", episodeTitle, "| showName:", showName);
  return { episodeTitle, showName };
}

type RssFeedResult =
  | { found: true; feedUrl: string; feedTitle: string }
  | { found: false; reason: "empty-results" | "no-match" | "unknown-show" };

/** Multi-pass iTunes search: episode-title first, then fall back to show-name lookup. */
async function findRssFeed(showName: string, episodeTitle?: string): Promise<RssFeedResult> {
  if (episodeTitle) {
    const cleanedEp = cleanSearchQuery(episodeTitle);
    console.log("-> iTunes Episode Query:", cleanedEp);

    const epRes = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanedEp)}&entity=podcastEpisode&limit=5`,
      { headers: { Accept: "application/json" } }
    );

    if (epRes.ok) {
      const epData: any = await epRes.json();
      console.log("-> iTunes Episode Results:", epData.results?.length);
      if (epData.results?.length) {
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

  const isUnknownShow = !showName || /^unknown\s*show$/i.test(showName);
  if (isUnknownShow) {
    console.log("-> Show name is unknown — skipping fallback search.");
    return { found: false, reason: "unknown-show" };
  }

  const cleanedName = cleanSearchQuery(showName);
  console.log("-> iTunes Show Query:", cleanedName);

  const showRes = await fetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(cleanedName)}&entity=podcast&limit=5`,
    { headers: { Accept: "application/json" } }
  );

  if (!showRes.ok) return { found: false, reason: "no-match" };

  const data: any = await showRes.json();
  console.log("-> iTunes Show Results:", data.results?.length);
  if (!data.results?.length) return { found: false, reason: "empty-results" };

  const normalizedTarget = cleanedName.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const r of data.results) {
    const candidate = (r.collectionName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (r.feedUrl && candidate.includes(normalizedTarget)) {
      return { found: true, feedUrl: r.feedUrl, feedTitle: r.collectionName };
    }
  }

  const first = data.results.find((r: any) => r.feedUrl);
  if (first) return { found: true, feedUrl: first.feedUrl, feedTitle: first.collectionName };

  return { found: false, reason: "no-match" };
}

function sanitizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function extractEpisodeNumber(title: string): string | null {
  const m = title.match(/(?:#|ep(?:isode)?\.?\s*)(\d+)/i);
  return m ? m[1] : null;
}

function wordOverlapRatio(a: string, b: string): number {
  const wa = a.split(/\s+/).filter(Boolean);
  const wb = b.split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  const common = wa.filter((w) => wb.includes(w)).length;
  return common / Math.max(wa.length, wb.length);
}

/** Parse the RSS XML and locate the episode with a matching title. */
async function findEpisodeInFeed(feedUrl: string, episodeTitle: string): Promise<RssEpisode | null> {
  const parser = new Parser({
    timeout: 15_000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SpotifyTranscriptor/1.0; +https://github.com)",
    },
  });

  const feed = await parser.parseURL(feedUrl);
  if (!feed.items?.length) return null;

  const sanitizedTarget = sanitizeTitle(episodeTitle);
  const targetEpNum = extractEpisodeNumber(episodeTitle);

  let bestFallback: { item: any; score: number } | null = null;

  for (const item of feed.items) {
    const itemTitle = [item.title, (item as any)["itunes:title"]].filter(Boolean).join(" ") || "";
    const sanitizedItem = sanitizeTitle(itemTitle);

    if (sanitizedItem.includes(sanitizedTarget) || sanitizedTarget.includes(sanitizedItem)) {
      const enclosureUrl = item.enclosure?.url ?? item.link ?? null;
      if (enclosureUrl) return { title: itemTitle, enclosureUrl };
    }

    if (targetEpNum) {
      const itemEpNum = extractEpisodeNumber(itemTitle);
      if (itemEpNum && itemEpNum === targetEpNum) {
        const enclosureUrl = item.enclosure?.url ?? item.link ?? null;
        if (enclosureUrl) return { title: itemTitle, enclosureUrl };
      }
    }

    const score = wordOverlapRatio(sanitizedTarget, sanitizedItem);
    if (score > 0 && (!bestFallback || score > bestFallback.score || (score === bestFallback.score && (item.isoDate ?? "") > (bestFallback.item.isoDate ?? "")))) {
      bestFallback = { item, score };
    }
  }

  if (bestFallback && bestFallback.score >= 0.45) {
    const enclosureUrl = bestFallback.item.enclosure?.url ?? bestFallback.item.link ?? null;
    if (enclosureUrl) {
      return { title: bestFallback.item.title ?? episodeTitle, enclosureUrl };
    }
  }

  if (feed.items?.length) {
    console.log("-> Sample RSS Titles in Feed:", feed.items.slice(0, 3).map((i: any) => i.title));
  }
  return null;
}

/** 🧠 STREAM TO DISK SOLUTION: Bypasses RAM footprint completely for incoming master audio streams */
async function streamAudioToDisk(url: string, destinationPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download audio (HTTP ${res.status})`);
  if (!res.body) throw new Error("Audio download body response configuration is empty.");

  const fileStream = fsSync.createWriteStream(destinationPath);
  await finished(Readable.fromWeb(res.body as any).pipe(fileStream));
}

/** Split an audio file path into 30s MP3 fragments directly on disk via native system ffmpeg binaries */
async function splitAudioIntoChunksOnDisk(inputPath: string, tmpDir: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
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
          resolve(chunkFiles.map((f) => path.join(tmpDir, f)));
        } catch (err) {
          reject(err);
        }
      })
      .on("error", (err) => {
        fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        reject(err);
      })
      .run();
  });
}

/** Transcribe a single chunk with retry; returns the text or a warning marker. */
async function transcribeChunk(chunkPath: string, chunkIndex: number, totalChunks: number): Promise<string> {
  const label = `Chunk ${chunkIndex}/${totalChunks}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const buffer = await fs.readFile(chunkPath);
      const rawBase64 = buffer.toString("base64");

      console.log(`-> Sending ${label} to OpenRouter via pure JSON Base64 string...`);

      const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/whisper-large-v3-turbo",
          input_audio: {
            format: "mp3",
            data: rawBase64,
          }
        }),
      });

      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData?.error?.message || `HTTP ${response.status}`);

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

  return `[⚠️ Audio segment unavailable — ${label}]`;
}

/** Pass the transcript through an LLM to strip sponsor/ad segments. */
async function filterAds(openai: OpenAI, rawTranscript: string, segments: TranscriptSegment[]): Promise<{ text: string; segments: TranscriptSegment[] }> {
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
      { role: "user", content: rawTranscript },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  });

  const cleaned = response.choices?.[0]?.message?.content?.trim();
  if (!cleaned) return { text: rawTranscript, segments };

  const cleanedSegments = segments.filter((seg) => cleaned.includes(seg.text)).map((seg) => ({ ...seg }));
  if (!cleanedSegments.length) return { text: rawTranscript, segments };

  return { text: cleaned, segments: cleanedSegments };
}

/* ------------------------------------------------------------------ */
/* POST handler                                                      */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  let tmpDir = "";
  try {
    const body = await req.json();
    const spotifyUrl: string | undefined = body.spotifyUrl;
    const filterAdsFlag: boolean = body.filterAds === true;

    if (!spotifyUrl || typeof spotifyUrl !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'spotifyUrl' in request body." }, { status: 400 });
    }

    const trimmedUrl = spotifyUrl.trim();

    // --- Step A: Scrape metadata ---
    const metadata = await scrapeSpotifyEpisode(trimmedUrl);
    if (!metadata) {
      return NextResponse.json({ error: "Could not find episode metadata on that Spotify page." }, { status: 400 });
    }

    // --- Step B: Multi-pass RSS feed resolution ---
    let rssFeedUrl: string | null = null;
    const rssResult = await findRssFeed(metadata.showName, metadata.episodeTitle);
    if (rssResult.found) {
      rssFeedUrl = rssResult.feedUrl;
      console.log("-> Parsed RSS URL:", rssFeedUrl);
    } else if (rssResult.reason === "empty-results") {
      return NextResponse.json({ error: "Show could not be resolved via public directories (Potential Spotify Exclusive)." }, { status: 404 });
    } else if (rssResult.reason === "unknown-show") {
      return NextResponse.json({ error: "This episode could not be located in public directories and is likely a Spotify Exclusive show." }, { status: 404 });
    }

    // --- Step C: Match episode in RSS feed & download audio via safe disk stream ---
    let audioFileProcessed = false;
    let episodeFound = false;

    if (rssFeedUrl) {
      try {
        const episode = await findEpisodeInFeed(rssFeedUrl, metadata.episodeTitle);
        if (episode?.enclosureUrl) {
          episodeFound = true;
          
          // 🧠 1. Set up ephemeral disk directory sandbox
          tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "st-"));
          const inputPath = path.join(tmpDir, "input.mp3");

          // 🧠 2. STREAM DOWN TO PHYSICAL DISK (Keeps RAM usage near zero)
          console.log("-> Starting memory-isolated download stream to disk...");
          await streamAudioToDisk(episode.enclosureUrl, inputPath);
          audioFileProcessed = true;
        }
      } catch (err: any) {
        rssFeedUrl = null;
      }
    }

    if (!audioFileProcessed) {
      const isExclusive = rssFeedUrl === null && !episodeFound ? " The show may be a Spotify Exclusive without a public RSS feed." : "";
      return NextResponse.json({
        error: "Could not locate or download the audio for this episode." + isExclusive,
        detail: "Spotify Exclusive shows often don't syndicate via public RSS.",
      }, { status: 404 });
    }

    // --- Step E: OpenRouter Transcription (Memory-Safe Pooled Workers Loop) ---
    let rawText: string;
    const inputPath = path.join(tmpDir, "input.mp3");

    // 🧠 1. Execute system binary audio division directly on disk
    console.log("-> Splitting file segments directly via system execution binaries...");
    const chunkPaths = await splitAudioIntoChunksOnDisk(inputPath, tmpDir);
    const total = chunkPaths.length;
    console.log(`-> Architecture split mapped into ${total} isolated segments`);

    // 🧠 2. Pooled Worker Queue Loop: Evaluates workers concurrently up to exact capacity limits (3)
    const transcripts: string[] = new Array(total);
    for (let i = 0; i < total; i += MAX_CONCURRENT_TRANSCRIBERS) {
      const slice = chunkPaths.slice(i, i + MAX_CONCURRENT_TRANSCRIBERS);
      
      await Promise.all(
        slice.map(async (chunkPath, sliceIndex) => {
          const globalIndex = i + sliceIndex;
          console.log(`-> Spinning worker payload channel for segment index: ${globalIndex + 1}/${total}`);
          // 🧠 Corrected call mapping arguments to line up exactly with type definitions
          transcripts[globalIndex] = await transcribeChunk(chunkPath, globalIndex + 1, total);
        })
      );
    }

    rawText = transcripts.join("\n\n");
    console.log("-> Stitched transcript:", rawText.length, "chars across", total, "chunks");

    // Clear disk space immediately after stitching strings
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });

    // --- Step F: Optional ad filtering ---
    const openai = createOpenRouterClient();
    let finalText = rawText;
    let adFiltered = false;

    if (filterAdsFlag) {
      try {
        const filtered = await filterAds(openai, rawText, []);
        finalText = filtered.text;
        adFiltered = true;
      } catch {
        adFiltered = false;
      }
    }

    return NextResponse.json({
      metadata,
      rssFeedUrl,
      transcript: finalText,
      segments: [],
      adFiltered,
    });
  } catch (err: any) {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return NextResponse.json({ error: err?.message ?? "An unexpected error occurred." }, { status: 500 });
  }
}