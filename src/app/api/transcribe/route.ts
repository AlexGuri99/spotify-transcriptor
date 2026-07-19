import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
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
import { findCachedEpisode, saveEpisodeRecord } from "@/lib/teable";

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

/* ------------------------------------------------------------------ */
/* Configs & Constants                                               */
/* ------------------------------------------------------------------ */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Maximum binary size before we split into chunks (4 MB — Base64 expansion + safety margin). */
const CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

/** Duration of each audio chunk in seconds (30 seconds — keeps Base64 payload small). */
const CHUNK_DURATION_SECONDS = 30;

/** 🔥 CRITICAL CONCURRENCY LIMIT: Process only 3 at a time to stay under 512MB RAM on Render */
const MAX_CONCURRENT_TRANSCRIBERS = 3;

/** Rate limiting — sliding window per IP */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitMap = new Map<string, number[]>();

/** Daily limit — 3 transcriptions per IP for unauthenticated users */
const DAILY_LIMIT = 3;
const dailyUsageMap = new Map<string, { date: string; count: number }>();

function checkDailyLimit(ip: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${today}:${ip}`;
  const entry = dailyUsageMap.get(key);
  if (!entry || entry.date !== today) {
    dailyUsageMap.set(key, { date: today, count: 0 });
    return true;
  }
  return entry.count < DAILY_LIMIT;
}

function incrementDailyUsage(ip: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${today}:${ip}`;
  const entry = dailyUsageMap.get(key);
  if (entry && entry.date === today) {
    entry.count++;
  } else {
    dailyUsageMap.set(key, { date: today, count: 1 });
  }
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) return true;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

/**
 * Rule 5 — in-memory processing lock.
 * Tracks episode IDs that are currently running through the Whisper pipeline
 * so concurrent requests for the same episode don't trigger duplicate work.
 *
 * Each entry is removed in the finally block of the streaming closure.
 */
const inProgressEpisodeIds = new Set<string>();

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

/* ------------------------------------------------------------------ */
/* Multi-platform URL detection                                       */
/* ------------------------------------------------------------------ */

const YOUTUBE_URL_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;
const APPLE_URL_RE = /podcasts\.apple\.com\/.*\/id(\d+)/;
const APPLE_EPISODE_ID_RE = /[\?&]i=(\d+)/;

function detectPlatform(url: string): "spotify" | "youtube" | "apple" | null {
  if (EPISODE_ID_RE.test(url)) return "spotify";
  if (YOUTUBE_URL_RE.test(url)) return "youtube";
  if (APPLE_URL_RE.test(url)) return "apple";
  return null;
}

function extractUrlId(url: string, mode: string): string | null {
  switch (mode) {
    case "spotify": return url.match(EPISODE_ID_RE)?.[1] ?? null;
    case "youtube": return url.match(YOUTUBE_URL_RE)?.[1] ?? null;
    case "apple": return url.match(APPLE_EPISODE_ID_RE)?.[1] ?? null;
    default: return null;
  }
}

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
  | { found: true; feedUrl: string; feedTitle: string; directAudioUrl?: string }
  | { found: false; reason: "empty-results" | "no-match" | "unknown-show" };

/** Multi-pass iTunes search: episode-title first, then fall back to show-name lookup. */
async function findRssFeed(
  showName: string,
  episodeTitle?: string
): Promise<RssFeedResult> {
  if (episodeTitle) {
    const cleanedEp = cleanSearchQuery(episodeTitle);
    console.log("-> 🎯 Querying iTunes Episodes:", cleanedEp);

    const epRes = await fetch(
      `https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&term=${encodeURIComponent(cleanedEp)}&limit=10`,
      { headers: { Accept: "application/json" } }
    );

    if (epRes.ok) {
      const epData: any = await epRes.json();
      console.log("-> iTunes Episode Results:", epData.results?.length);
      if (epData.results?.length) {
        const knownFalsePositives = ["trading secrets"];

        // Score every result using title-overlap against the target episode,
        // and skip known false-positive collections unless it's an exact match.
        const scored: { result: any; score: number; exact: boolean }[] = [];

        for (const r of epData.results) {
          const sanitizedTrack = sanitizeTitle(r.trackName ?? "");
          const sanitizedTarget = sanitizeTitle(episodeTitle);
          const score = wordOverlapRatio(sanitizedTarget, sanitizedTrack);
          const exactMatch = sanitizedTrack === sanitizedTarget;

          const collectionKey = (r.collectionName ?? "").toLowerCase().trim();
          const isKnownFP = knownFalsePositives.some((fp) =>
            collectionKey.includes(fp)
          );

          if (isKnownFP && !exactMatch) {
            console.log(
              "-> Skipping known false-positive — no exact match:",
              r.collectionName,
              r.trackName
            );
            continue;
          }

          scored.push({ result: r, score, exact: exactMatch });
        }

        if (scored.length) {
          scored.sort((a, b) => b.score - a.score);

          const best =
            scored.find((s) => s.result.enclosureUrl ?? s.result.previewUrl) ??
            scored.find((s) => s.result.feedUrl);

          if (best) {
            console.log(
              "-> 🎯 Selected accurate podcast:",
              best.result.collectionName ?? "",
              "| track:",
              best.result.trackName
            );
            const directAudioUrl =
              best.result.enclosureUrl ?? best.result.previewUrl ?? null;
            if (directAudioUrl) {
              console.log(
                "-> 🚀 Shortcut! Found direct audio stream link:",
                directAudioUrl
              );
              console.log(
                "-> Found feedUrl via episode search:",
                best.result.feedUrl
              );
              return {
                found: true,
                feedUrl: best.result.feedUrl ?? "",
                feedTitle: best.result.collectionName ?? "",
                directAudioUrl,
              };
            }
            console.log(
              "-> Found feedUrl via episode search:",
              best.result.feedUrl
            );
            return {
              found: true,
              feedUrl: best.result.feedUrl,
              feedTitle: best.result.collectionName ?? "",
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
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Referer": "https://www.google.com/",
    },
  });
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
/* Apple Podcasts resolution — iTunes lookup → direct audio URL       */
/* ------------------------------------------------------------------ */

interface AppleEpisodeInfo {
  audioUrl: string;
  episodeTitle: string;
  showName: string;
}

async function resolveAppleEpisode(episodeId: string): Promise<AppleEpisodeInfo> {
  const res = await fetch(
    `https://itunes.apple.com/lookup?id=${episodeId}&entity=podcastEpisode`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`iTunes lookup returned HTTP ${res.status}`);
  const data: any = await res.json();
  const result = data.results?.[0];
  if (!result) throw new Error("Episode not found on Apple Podcasts.");
  const audioUrl = result.previewUrl ?? result.episodeUrl;
  if (!audioUrl) throw new Error("No audio URL found for this Apple Podcasts episode.");
  return {
    audioUrl,
    episodeTitle: result.trackName ?? "Unknown Episode",
    showName: result.collectionName ?? "Unknown Show",
  };
}

/* ------------------------------------------------------------------ */
/* YouTube captions — extract native timed captions from video page   */
/* ------------------------------------------------------------------ */

interface YouTubeCaptionSegment {
  start: number;
  end: number;
  text: string;
}

async function fetchYouTubeCaptions(videoId: string): Promise<{
  episodeTitle: string;
  showName: string;
  segments: YouTubeCaptionSegment[];
}> {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });
  if (!pageRes.ok) throw new Error(`Failed to fetch YouTube page (HTTP ${pageRes.status})`);
  const html = await pageRes.text();

  // Extract video title and channel name
  let episodeTitle = "Unknown Video";
  let showName = "Unknown Channel";
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  if (titleMatch) episodeTitle = titleMatch[1].replace(" - YouTube", "").trim();
  const channelMatch = html.match(/"author":"([^"]+)"/);
  if (channelMatch) showName = channelMatch[1];

  // Extract caption tracks from ytInitialPlayerResponse
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.*?});/);
  if (!playerMatch) throw new Error("Could not extract player response from YouTube page.");
  const playerData: any = JSON.parse(playerMatch[1]);
  const captionTracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks?.length) throw new Error("No captions available for this YouTube video.");

  // Prefer English, fall back to first available track
  const track =
    captionTracks.find((t: any) => t.languageCode?.startsWith("en")) ?? captionTracks[0];
  const captionsUrl: string | undefined = track.baseUrl;
  if (!captionsUrl) throw new Error("Caption track baseUrl is empty or undefined.");

  const captionsRes = await fetch(captionsUrl);
  if (!captionsRes.ok) throw new Error(`Failed to fetch captions (HTTP ${captionsRes.status})`);
  const captionsXml = await captionsRes.text();
  if (!captionsXml.trim()) throw new Error("Captions XML body is empty.");

  // Parse XML <text> elements with start / dur attributes
  const segments: YouTubeCaptionSegment[] = [];
  const textRe = /<text start="([\d.]+)" dur="([\d.]*)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(captionsXml)) !== null) {
    const start = parseFloat(m[1]);
    const dur = m[2] ? parseFloat(m[2]) : 2;
    const text = m[3]
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .trim();
    if (text) segments.push({ start, end: start + dur, text });
  }

  if (!segments.length) throw new Error("No caption text found.");
  return { episodeTitle, showName, segments };
}

/* ------------------------------------------------------------------ */
/* POST handler — streaming NDJSON response                           */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json();
  const sourceMode: string = body.sourceMode ?? "spotify";
  const inputUrl: string | undefined = body.url;
  const filterAdsFlag: boolean = body.filterAds === true;
  const startTime = Date.now();

  // Temporarily force Spotify-only pipeline; multi-platform handlers below are preserved but unreachable.
  const effectiveMode = "spotify" as const;

  // --- URL validation ---
  if (!inputUrl || typeof inputUrl !== "string" || !inputUrl.trim()) {
    return Response.json(
      { type: "error", error: "Missing or invalid URL in request body." },
      { status: 400 }
    );
  }
  const trimmedUrl = inputUrl.trim();

  /* ------------------------------------------------------------------ */
  /* Rate limiting — sliding window per IP                              */
  /* ------------------------------------------------------------------ */
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")
    ?? "unknown";

  /* ------------------------------------------------------------------ */
  /* Daily limit — unauthenticated users get 3 transcriptions per day   */
  /* ------------------------------------------------------------------ */
  const session = await getServerSession(authOptions);
  const isAuthenticated = !!session?.user;
  if (!isAuthenticated && !checkDailyLimit(ip)) {
    return Response.json(
      {
        type: "daily_limit",
        error: "You've used all 3 free transcriptions for today.",
        detail: "Sign in to continue transcribing with unlimited access.",
      },
      { status: 429 }
    );
  }

  if (isRateLimited(ip)) {
    return Response.json(
      { type: "error", error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  /* ------------------------------------------------------------------ */
  /* RULE 1 — Standardize and Extract                                   */
  /* Extract the unique 22-character alphanumeric Spotify episode ID     */
  /* from the URL. Do not use the raw URL string for database matching. */
  /* ------------------------------------------------------------------ */
  const episodeIdMatch = trimmedUrl.match(EPISODE_ID_RE);
  const episodeId = episodeIdMatch?.[1] ?? null;

  if (!episodeId) {
    return Response.json(
      {
        type: "error",
        error:
          "Could not recognize the URL format. Please check the link and try again.",
      },
      { status: 400 }
    );
  }

  /* ------------------------------------------------------------------ */
  /* RULE 5 — Prevent Parallel Processing                               */
  /* If this episode is already running through the active Whisper       */
  /* pipeline, reject the duplicate before it can start.                */
  /* ------------------------------------------------------------------ */
  if (inProgressEpisodeIds.has(episodeId)) {
    return Response.json(
      {
        type: "error",
        error:
          "This episode is currently being transcribed. Please wait a moment and try again.",
      },
      { status: 409 }
    );
  }

  /* --- Register lock before entering the streaming pipeline --- */
  inProgressEpisodeIds.add(episodeId);
  console.log(`[Lock] Acquired for episode ${episodeId}`);

  // --- Proceed with streaming NDJSON ---
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = (data: Record<string, unknown>) =>
    writer.write(encoder.encode(JSON.stringify(data) + "\n"));

  const executionPromise = (async () => {
    let tmpDir = "";
    try {
      /* ---------------------------------------------------------------- */
      /* RULES 2-4 — Cache check inside streaming for NDJSON consistency  */
      /* ---------------------------------------------------------------- */
      const cachedEpisode = await findCachedEpisode(episodeId);
      if (cachedEpisode) {
        await send({
          type: "status",
          message: "Extracting cached timeline matrices...",
        });

        const transcript = cachedEpisode.segments
          .map((s) => s.text)
          .join("\n\n");
        const metadata: ScrapedMetadata = {
          episodeTitle: cachedEpisode.title,
          showName: "",
        };

        console.log(
          `[Cache] HIT for episode ${episodeId} — delaying 10s to mask cache behavior`
        );
        await new Promise((r) => setTimeout(r, 10_000));

        await send({
          type: "result",
          cached: true,
          delayRequired: true,
          data: {
            metadata,
            rssFeedUrl: null,
            transcript,
            segments: cachedEpisode.segments,
            adFiltered: false,
            executionTime: cachedEpisode.executionTime,
          },
        });

        return; /* early exit — finally block handles lock cleanup */
      }

      /* ---------------------------------------------------------------- */
      /* YOUTUBE — try native captions first, fall back to audio DL      */
      /* ---------------------------------------------------------------- */
      if (false) {
        /* YOUTUBE — disabled; effectiveMode forces Spotify pipeline
        ...
        Entire YouTube handler code is commented out to bypass TS strict-null checks.
        ... */
      }

      /* ---------------------------------------------------------------- */
      /* APPLE — iTunes lookup → direct audio stream → transcribe         */
      /* ---------------------------------------------------------------- */
      if (false) {
        /* APPLE — disabled; effectiveMode forces Spotify pipeline
        ...
        Entire Apple handler code is commented out to bypass TS strict-null checks.
        ... */
      }

      /* ---------------------------------------------------------------- */
      /* SPOTIFY (default) — oEmbed → RSS → audio → transcribe           */
      /* ---------------------------------------------------------------- */

      // --- Step A: Scrape metadata ---
      await send({ type: "status", message: "Fetching episode metadata..." });
      const metadata = await scrapeSpotifyEpisode(trimmedUrl);
      if (!metadata) {
        await send({ type: "error", error: "Could not find episode metadata on that Spotify page." });
        return;
      }

      // --- Step B: Multi-pass RSS feed resolution ---
      await send({ type: "status", message: "Resolving RSS feed..." });
      let rssFeedUrl: string | null = null;
      const rssResult = await findRssFeed(metadata.showName, metadata.episodeTitle);
      if (rssResult.found) {
        rssFeedUrl = rssResult.feedUrl || null;
        if (rssFeedUrl) console.log("-> Parsed RSS URL:", rssFeedUrl);
      } else if (rssResult.reason === "empty-results") {
        await send({ type: "error", error: "Show could not be resolved via public directories (Potential Spotify Exclusive)." });
        return;
      } else if (rssResult.reason === "unknown-show") {
        await send({ type: "error", error: "This episode could not be located in public directories and is likely a Spotify Exclusive show." });
        return;
      }

      // --- Step C: Match episode in RSS feed & download audio via safe disk stream ---
      await send({ type: "status", message: "Downloading audio..." });
      let audioFileProcessed = false;
      let episodeFound = false;

      const directAudioUrl = rssResult.found ? rssResult.directAudioUrl : undefined;
      if (directAudioUrl) {
        episodeFound = true;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "st-"));
        const inputPath = path.join(tmpDir, "input.mp3");
        console.log("-> Starting memory-isolated download stream to disk...");
        await streamAudioToDisk(directAudioUrl, inputPath);
        audioFileProcessed = true;
      } else if (rssFeedUrl) {
        try {
          const episode = await findEpisodeInFeed(rssFeedUrl, metadata.episodeTitle);
          if (episode?.enclosureUrl) {
            episodeFound = true;
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "st-"));
            const inputPath = path.join(tmpDir, "input.mp3");
            console.log("-> Starting memory-isolated download stream to disk...");
            await streamAudioToDisk(episode.enclosureUrl, inputPath);
            audioFileProcessed = true;
          }
        } catch (err: any) {
          rssFeedUrl = null;
        }
      }

      if (!audioFileProcessed) {
        const isExclusive = rssFeedUrl === null && !episodeFound
          ? " The show may be a Spotify Exclusive without a public RSS feed."
          : "";
        await send({
          type: "error",
          error: "Could not locate or download the audio for this episode." + isExclusive,
          detail: "Spotify Exclusive shows often don't syndicate via public RSS.",
        });
        return;
      }

      // --- Steps D–F: split, transcribe, filter (shared with Apple path) ---
      await send({ type: "status", message: "Processing audio segments..." });
      const inputPath = path.join(tmpDir, "input.mp3");
      console.log("-> Splitting file segments directly via system execution binaries...");
      const chunkPaths = await splitAudioIntoChunksOnDisk(inputPath, tmpDir);
      const total = chunkPaths.length;
      console.log(`-> Architecture split mapped into ${total} isolated segments`);
      await send({ type: "chunks", count: total });

      const transcripts: string[] = new Array(total);
      for (let i = 0; i < total; i += MAX_CONCURRENT_TRANSCRIBERS) {
        const slice = chunkPaths.slice(i, i + MAX_CONCURRENT_TRANSCRIBERS);
        await Promise.all(
          slice.map(async (chunkPath, sliceIndex) => {
            const globalIndex = i + sliceIndex;
            console.log(`-> Spinning worker payload channel for segment index: ${globalIndex + 1}/${total}`);
            transcripts[globalIndex] = await transcribeChunk(chunkPath, globalIndex + 1, total);
          })
        );
      }

      const rawText = transcripts.join("\n\n");
      console.log("-> Stitched transcript:", rawText.length, "chars across", total, "chunks");
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      tmpDir = "";

      const openai = createOpenRouterClient();
      let finalText = rawText;
      let adFiltered = false;
      if (filterAdsFlag) {
        await send({ type: "status", message: "Filtering advertisements..." });
        try {
          const filtered = await filterAds(openai, rawText, []);
          finalText = filtered.text;
          adFiltered = true;
        } catch {
          adFiltered = false;
        }
      }

      const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
      const estimatedCost = total * 0.000333;
      console.log(`==================================================`);
      console.log(`🏁 PROCESSING COMPLETION METRICS`);
      console.log(`⏱️ Total Execution Time: ${elapsedSeconds} seconds`);
      console.log(`📦 Total Audio Chunks Processed: ${total}`);
      console.log(`💰 Estimated OpenRouter Cost: $${estimatedCost.toFixed(6)}`);
      console.log(`==================================================`);

      const finalSegments: TranscriptSegment[] = transcripts.map(
        (text, i) => ({
          start: i * CHUNK_DURATION_SECONDS,
          end: (i + 1) * CHUNK_DURATION_SECONDS,
          text,
        })
      );

      /* ---------------------------------------------------------------- */
      /* SEQUENTIAL SYNC: Save to Teable BEFORE sending the result token.  */
      /* This guarantees the database write completes while the stream is  */
      /* still open and the platform runtime cannot cut us off.            */
      /* ---------------------------------------------------------------- */
      console.log("📡 [Pipeline Sync Complete] Safely committing records straight to Teable...");
      await saveEpisodeRecord({
        episodeId,
        title: metadata.episodeTitle,
        segments: finalSegments,
        executionTime: Number(elapsedSeconds),
      });
      console.log("🎉 [Pipeline Sync Complete] Teable write confirmed!");

      if (!isAuthenticated) {
        incrementDailyUsage(ip);
        console.log(`[DailyLimit] Incremented for IP ${ip}`);
      }

      await send({
        type: "result",
        data: {
          metadata,
          rssFeedUrl,
          transcript: finalText,
          segments: finalSegments,
          adFiltered,
          executionTime: Number(elapsedSeconds),
        },
      });
    } catch (err: any) {
      try {
        await send({ type: "error", error: err?.message ?? "An unexpected error occurred." });
      } catch { /* writer may already be closed */ }
    } finally {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      /* RULE 5 — Release the processing lock so future requests can proceed */
      inProgressEpisodeIds.delete(episodeId);
      console.log(`[Lock] Released for episode ${episodeId}`);
      try { await writer.close(); } catch { /* stream already closed */ }
    }
  })();

  /* waitUntil is not part of the NextRequest type, but is available at
   * runtime on platforms like Vercel Edge, Cloudflare Workers, and Railway.
   * It keeps the runtime from terminating before the background streaming,
   * transcription, and saveEpisodeRecord complete. */
  const waitUntil = (req as any).waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil(executionPromise);
  }

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-cache",
    },
  });
}