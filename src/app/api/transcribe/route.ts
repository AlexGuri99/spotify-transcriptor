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
import { getUsageStats, deductCredit, getUserData, addTranscription } from "@/lib/usage-tracker";
import { findViaPodcastIndex } from "@/lib/podcast-index";

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
  description?: string;
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

/** Maximum binary size before we split into chunks (4 MB â€” Base64 expansion + safety margin). */
const CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

/** Duration of each audio chunk in seconds (30 seconds â€” keeps Base64 payload small). */
const CHUNK_DURATION_SECONDS = 30;

/** ðŸ”¥ CRITICAL CONCURRENCY LIMIT: Process only 3 at a time to stay under 512MB RAM on Render */
const MAX_CONCURRENT_TRANSCRIBERS = 3;

/** Rate limiting â€” sliding window per IP */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitMap = new Map<string, number[]>();

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
 * Rule 5 â€” in-memory processing lock.
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

  /* ── Show name extraction ────────────────────────────────────────────
   * Spotify oEmbed sometimes omits author_name for podcasts. The title
   * field follows a multi-pipe format:
   *   "Episode Details | Show Name | Category Keywords"
   * The second " | " segment is the actual show name, NOT the last one
   * (which contains marketing/category text like "Fantasy Premier League Tips").
   * ───────────────────────────────────────────────────────────────── */
  if (authorName) {
    showName = authorName;
  } else {
    const pipeParts = rawTitle.split(" | ").map((s) => s.trim());
    if (pipeParts.length >= 3) {
      // Format: "Episode Info | Show Name | Keywords"
      showName = pipeParts[1];
    } else if (pipeParts.length === 2) {
      // Format: "Episode Title | Show Name"
      showName = pipeParts[1];
    } else {
      showName = "Unknown Show";
    }
  }

  /* ── Episode title extraction ────────────────────────────────────────
   * Strip " | ShowName" and " | Keywords" tails from the title, then
   * apply the dash-split for the clean episode description.
   * ───────────────────────────────────────────────────────────────── */
  const hasIndexPrefix = /^(?:×¤×¨×§\s|Ep[\s.]|Episode\s)/i.test(rawTitle);

  if (hasIndexPrefix) {
    episodeTitle = rawTitle;
  } else {
    // Strip trailing " | ShowName" and " | Keywords" so they don't pollute
    const pipeParts = rawTitle.split(" | ").map((s) => s.trim());
    const titleMinusShow = pipeParts[0];

    // Now try dash-split: "Title - Subtitle" within the cleaned portion
    const dashMatch = titleMinusShow.match(/^(.+?)\s+[-â€“â€”]\s+(.+)$/);
    episodeTitle = dashMatch ? dashMatch[1].trim() : titleMinusShow;
  }

  console.log("-> Final â€” episodeTitle:", episodeTitle, "| showName:", showName);
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
    console.log("-> ðŸŽ¯ Querying iTunes Episodes:", cleanedEp);

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
        const scored: { result: any; score: number; exact: boolean; showMatchScore: number }[] = [];

        const sanitizedShow = showName ? sanitizeTitle(showName) : "";

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
              "-> Skipping known false-positive â€” no exact match:",
              r.collectionName,
              r.trackName
            );
            continue;
          }

          /* ── Show-name cross-verification ───────────────────────────────
           * The iTunes episode search returns episodes from ALL shows.
           * Check that the result's collectionName matches the show name
           * from oEmbed, so results from unrelated shows are deprioritized.
           * ───────────────────────────────────────────────── */
          const sanitizedCollection = sanitizeTitle(r.collectionName ?? "");
          const showMatchScore = sanitizedShow
            ? wordOverlapRatio(sanitizedCollection, sanitizedShow)
            : 0;

          scored.push({ result: r, score, exact: exactMatch, showMatchScore });
        }

        if (scored.length) {
          // Sort by show-match first, then by title-score
          scored.sort((a, b) => {
            // Exact matches on both show AND title rank highest
            if (a.exact && a.showMatchScore >= 0.5) return -1;
            if (b.exact && b.showMatchScore >= 0.5) return 1;
            // Then sort by combined score (title + show)
            const aCombined = a.score + a.showMatchScore;
            const bCombined = b.score + b.showMatchScore;
            return bCombined - aCombined;
          });

          /* When taking the direct-audio shortcut, require that the
           * show names also match — otherwise we risk downloading
           * audio from a completely different podcast. */
          const hasMatchingShow = scored.some((s) => s.showMatchScore >= 0.5);
          const best =
            (hasMatchingShow
              ? scored.find((s) => s.result.enclosureUrl && s.showMatchScore >= 0.5)
              : null) ??
            scored.find((s) => s.result.enclosureUrl) ??
            (hasMatchingShow
              ? scored.find((s) => s.result.feedUrl && s.showMatchScore >= 0.5)
              : null) ??
            scored.find((s) => s.result.feedUrl);

          if (best) {
            console.log(
              "-> ðŸŽ¯ Selected accurate podcast:",
              best.result.collectionName ?? "",
              "| track:",
              best.result.trackName
            );
            const directAudioUrl =
              best.result.enclosureUrl ?? null;
            if (directAudioUrl) {
              console.log(
                "-> ðŸš€ Shortcut! Found direct audio stream link:",
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
    console.log("-> Show name is unknown â€” skipping fallback search.");
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

/**
 * Pick the best RSS feed result from parallel iTunes and Podcast Index searches.
 * Priority: directAudioUrl > found:true > any result.
 * Tie-breaks by show-name overlap when both have equivalent quality.
 */
function pickBestResult(a: RssFeedResult, b: RssFeedResult, showName?: string): RssFeedResult {
  function score(r: RssFeedResult): number {
    if (r.found && r.directAudioUrl) return 3;
    if (r.found) return 2;
    return 1;
  }

  const scoreA = score(a);
  const scoreB = score(b);

  if (scoreA !== scoreB) return scoreA > scoreB ? a : b;

  // Tie: prefer better show-name overlap
  if (scoreA >= 2 && showName) {
    const aTitle = a.found ? sanitizeTitle(a.feedTitle) : "";
    const bTitle = b.found ? sanitizeTitle(b.feedTitle) : "";
    const showClean = sanitizeTitle(showName);
    const aOverlap = showClean ? wordOverlapRatio(showClean, aTitle) : 0;
    const bOverlap = showClean ? wordOverlapRatio(showClean, bTitle) : 0;
    if (aOverlap !== bOverlap) return aOverlap > bOverlap ? a : b;
  }

  // Still tied: Podcast Index result (fewer downstream steps since it
  // already resolved enclosureUrl, equivalent to directAudioUrl)
  return b;
}

/** Parse the RSS XML and locate the episode with a matching title or GUID. */
async function findEpisodeInFeed(feedUrl: string, episodeTitle: string, spotifyEpisodeId?: string): Promise<RssEpisode | null> {
  const parser = new Parser({
    timeout: 15_000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SpotifyTranscriptor/1.0; +https://github.com)",
    },
  });

  const feed = await parser.parseURL(feedUrl);
  if (!feed.items?.length) return null;

  /* ── Priority 1: GUID matching ───────────────────────────────────
   * Many podcast RSS feeds include the Spotify episode URL directly
   * as the GUID. This is vastly more reliable than title matching
   * because it uses the actual episode identifier instead of text.
   * ────────────────────────────────────────────────────────────── */
  if (spotifyEpisodeId) {
    const lowerId = spotifyEpisodeId.toLowerCase();
    for (const item of feed.items) {
      const guid = (item.guid ?? "").toLowerCase();
      if (guid.includes(lowerId)) {
        const enclosureUrl = item.enclosure?.url ?? item.link ?? null;
        if (enclosureUrl) {
          console.log("-> GUID match found for episode", spotifyEpisodeId);
          return { title: item.title ?? episodeTitle, enclosureUrl, description: item.contentSnippet ?? item.description ?? undefined };
        }
      }
    }
  }

  const sanitizedTarget = sanitizeTitle(episodeTitle);
  const targetEpNum = extractEpisodeNumber(episodeTitle);

  let bestFallback: { item: any; score: number } | null = null;

  for (const item of feed.items) {
    const itemTitle = [item.title, (item as any)["itunes:title"]].filter(Boolean).join(" ") || "";
    const sanitizedItem = sanitizeTitle(itemTitle);

    if (sanitizedItem.includes(sanitizedTarget) || sanitizedTarget.includes(sanitizedItem)) {
      const enclosureUrl = item.enclosure?.url ?? item.link ?? null;
      if (enclosureUrl) return { title: itemTitle, enclosureUrl, description: item.contentSnippet ?? item.description ?? undefined };
    }

    if (targetEpNum) {
      const itemEpNum = extractEpisodeNumber(itemTitle);
      if (itemEpNum && itemEpNum === targetEpNum) {
        const enclosureUrl = item.enclosure?.url ?? item.link ?? null;
        if (enclosureUrl) return { title: itemTitle, enclosureUrl, description: item.contentSnippet ?? item.description ?? undefined };
      }
    }

    const score = wordOverlapRatio(sanitizedTarget, sanitizedItem);
    if (score > 0 && (!bestFallback || score > bestFallback.score || (score === bestFallback.score && (item.isoDate ?? "") > (bestFallback.item.isoDate ?? "")))) {
      bestFallback = { item, score };
    }
  }

  if (bestFallback && bestFallback.score >= 0.70) {
    const enclosureUrl = bestFallback.item.enclosure?.url ?? bestFallback.item.link ?? null;
    if (enclosureUrl) {
      return { title: bestFallback.item.title ?? episodeTitle, enclosureUrl, description: bestFallback.item.contentSnippet ?? bestFallback.item.description ?? undefined };
    }
  }

  if (feed.items?.length) {
    console.log("-> Sample RSS Titles in Feed:", feed.items.slice(0, 3).map((i: any) => i.title));
  }
  return null;
}

/** ðŸ§  STREAM TO DISK SOLUTION: Bypasses RAM footprint completely for incoming master audio streams */
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

/** Use ffprobe to get audio duration in seconds. */
function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata?.format?.duration ?? 0);
    });
  });
}

interface ChunkInfo {
  path: string;
  startTime: number;
  duration: number;
}

/** Split audio: first 2 min into 10s chunks for fine-grained ad detection, rest into 30s chunks. */
async function splitAudioIntoChunksOnDisk(inputPath: string, tmpDir: string, totalDuration: number): Promise<ChunkInfo[]> {
  const chunks: ChunkInfo[] = [];
  const fineDuration = 10;
  const coarseDuration = 30;
  const fineSpan = Math.min(120, totalDuration);

  // Split first 2 minutes into 10-second fine-grained chunks
  for (let start = 0; start < fineSpan; start += fineDuration) {
    const outputPath = path.join(tmpDir, `fine_${String(chunks.length).padStart(3, "0")}.mp3`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(start)
        .duration(fineDuration)
        .outputOptions(["-c", "copy", "-map", "0:a"])
        .output(outputPath)
        .on("end", () => {
          chunks.push({ path: outputPath, startTime: start, duration: fineDuration });
          resolve();
        })
        .on("error", reject)
        .run();
    });
  }

  // Split the rest (after 2 min) into 30-second coarse chunks
  if (totalDuration > fineSpan) {
    const outputPattern = path.join(tmpDir, "coarse_%03d.mp3");
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(fineSpan)
        .outputOptions([
          "-f", "segment",
          "-segment_time", String(coarseDuration),
          "-reset_timestamps", "1",
          "-c", "copy",
          "-map", "0:a",
        ])
        .output(outputPattern)
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    const files = await fs.readdir(tmpDir);
    const restChunks = files.filter((f) => f.startsWith("coarse_")).sort();
    for (let i = 0; i < restChunks.length; i++) {
      const startTime = fineSpan + i * coarseDuration;
      chunks.push({
        path: path.join(tmpDir, restChunks[i]),
        startTime,
        duration: Math.min(coarseDuration, totalDuration - startTime),
      });
    }
  }

  return chunks;
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
      console.log(`-> âœ… ${label} transcribed (${text.length} chars)`);
      return text;
    } catch (err: any) {
      console.log(`-> âŒ ${label} attempt ${attempt}/3 failed: ${err.message || err}`);
      if (attempt < 3) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return `[âš ï¸ Audio segment unavailable â€” ${label}]`;
}

/** Pass the transcript through an LLM to strip sponsor/ad segments. */
async function filterAds(openai: OpenAI, rawTranscript: string, segments: TranscriptSegment[], description?: string): Promise<{ text: string; segments: TranscriptSegment[] }> {
  if (segments.length === 0) return { text: rawTranscript, segments };

  // Label segments with indices so the LLM can reference them
  const segmentLines = segments
    .map((s, i) => `[${i}] ${s.text}`)
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: [
          "You are a podcast transcript editor. Segments are labeled with [index].",
          "",
          "Do TWO things:",
          "1) Return the FULL transcript with ALL sponsor reads, ad reads, promo codes, and paid endorsements REMOVED.",
          "2) Identify which segment contains the first line of actual podcast content.",
          "",
          "Rules for removing ads:",
          "- Remove entire ad segments (sponsor reads, promo codes, paid endorsements).",
          "- If a segment mixes ad and content, REMOVE only the ad portion and KEEP the content.",
          "- Do NOT remove host banter, episode topic previews, or show self-promotion.",
          "- ONLY remove segments that are clearly third-party paid advertisements.",
          "",
          "Return ONLY valid JSON (no markdown, no explanation):",
          JSON.stringify({
            cleaned_transcript: "transcript with ads removed...",
            first_content_index: 4,
            first_content_text: null,
          }),
          "",
          "- cleaned_transcript: the full transcript with ad content removed. Do NOT rewrite or paraphrase.",
          "- first_content_index: the 0-based segment index where the actual podcast content FIRST begins. All segments before this index are pre-roll ads.",
          "- first_content_text: OPTIONAL. If the first content segment also contains the tail of an ad, set this to the exact text where content starts. Otherwise null.",
          "",
          "HINT: The episode show notes (provided below) list the episode's sponsors. Use this as a signal when identifying ad segments.",
        ].join("\n"),
      },
      { role: "user", content: (description ? `Episode show notes:\n${description}\n\n---\n\nSegments:\n${segmentLines}` : segmentLines) },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  });

  const raw = response.choices?.[0]?.message?.content?.trim();
  if (!raw) return { text: rawTranscript, segments };

  // Try to parse structured JSON
  let parsed: any;
  try {
    const json = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    parsed = JSON.parse(json);
  } catch {
    // Fallback: use raw LLM text with overlap scoring
    return filterByOverlap(raw, rawTranscript, segments);
  }

  const cleanedTranscript: string | undefined = parsed?.cleaned_transcript;
  if (!cleanedTranscript || cleanedTranscript.length < 10) return { text: rawTranscript, segments };

  // Filter segments by word-overlap against the cleaned transcript
  const keptSegments = filterSegmentsByOverlap(segments, cleanedTranscript);

  // Handle the beginning: trim pre-roll ads and boundary
  const firstContentIndex: number | undefined = parsed.first_content_index;
  if (typeof firstContentIndex === "number" && firstContentIndex > 0 && firstContentIndex < segments.length) {
    const boundaryIdx = keptSegments.findIndex(s => {
      const origIdx = segments.indexOf(s);
      return origIdx >= firstContentIndex;
    });

    if (boundaryIdx > 0) {
      keptSegments.splice(0, boundaryIdx);
    }
  }

  // Trim boundary segment text if needed
  const firstContentText: string | undefined = parsed.first_content_text;
  if (firstContentText && typeof firstContentText === "string" && firstContentText.length > 10 && keptSegments.length > 0) {
    const startPos = keptSegments[0].text.indexOf(firstContentText);
    if (startPos > 0) {
      keptSegments[0] = { ...keptSegments[0], text: keptSegments[0].text.slice(startPos) };
    }
  }

  if (keptSegments.length === 0) return { text: cleanedTranscript, segments };
  const text = keptSegments.map((s) => s.text).join("\n\n");
  return { text, segments: keptSegments };
}

/** Keep segments whose words substantially overlap with the LLM-cleaned text. */
function filterSegmentsByOverlap(
  segments: TranscriptSegment[],
  cleaned: string
): TranscriptSegment[] {
  const cleanedLower = cleaned.toLowerCase();

  function overlapRatio(segText: string): number {
    const words = segText.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) return 0;
    let matched = 0;
    for (const w of words) {
      if (cleanedLower.includes(w)) matched++;
    }
    return matched / words.length;
  }

  return segments.filter((seg) => overlapRatio(seg.text) >= 0.4);
}

/** Fallback: keep segments whose words substantially overlap with raw LLM text. */
function filterByOverlap(
  cleaned: string,
  rawTranscript: string,
  segments: TranscriptSegment[]
): { text: string; segments: TranscriptSegment[] } {
  const keptSegments = filterSegmentsByOverlap(segments, cleaned);
  if (keptSegments.length === 0) return { text: rawTranscript, segments };
  const text = keptSegments.map((s) => s.text).join("\n\n");
  return { text, segments: keptSegments };
}
/* ------------------------------------------------------------------ */
/* Apple Podcasts resolution â€” iTunes lookup â†’ direct audio URL       */
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
/* YouTube captions â€” extract native timed captions from video page   */
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
/* POST handler â€” streaming NDJSON response                           */
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
  /* Rate limiting â€” sliding window per IP                              */
  /* ------------------------------------------------------------------ */
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")
    ?? "unknown";

  /* ------------------------------------------------------------------ */
  /* Anonymous users must sign up â€” no free transcriptions without auth */
  /* ------------------------------------------------------------------ */
  const session = await getServerSession(authOptions);
  const isAuthenticated = !!session?.user;
  if (!isAuthenticated) {
    return Response.json(
      {
        type: "sign_up_required",
        error: "Sign up for free to transcribe this episode.",
        detail: "No credit card needed. You get 5 free transcriptions every month.",
      },
      { status: 401 }
    );
  }

  /* ------------------------------------------------------------------ */
  /* Free plan monthly limit â€” 15 transcriptions per month              */
  /* ------------------------------------------------------------------ */
  if (!session?.user?.email) {
    return Response.json(
      { type: "error", error: "Authentication error." },
      { status: 401 }
    );
  }
  const email = session.user.email;
  const usage = await getUsageStats(email).catch(() => null);
  if (usage && usage.remaining <= 0) {
    return Response.json(
      {
        type: "plan_limit",
        error: `You've used all ${usage.planLimit} free transcriptions this month.`,
        detail: "Upgrade to Pro for more, or wait until your plan resets next month.",
      },
      { status: 429 }
    );
  }

  /* Check credit balance for PayGo users */
  if (usage) {
    const userData = await getUserData(email);
    if (userData.plan === "credits" && userData.creditsRemaining <= 0) {
      return Response.json(
        {
          type: "plan_limit",
          error: "You're out of credits.",
          detail: "Purchase more credits to continue transcribing.",
        },
        { status: 429 }
      );
    }
  }

  if (isRateLimited(ip)) {
    return Response.json(
      { type: "error", error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  /* ------------------------------------------------------------------ */
  /* RULE 1 â€” Standardize and Extract                                   */
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
  /* RULE 5 â€” Prevent Parallel Processing                               */
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
      const openai = createOpenRouterClient();
      /* ---------------------------------------------------------------- */
      /* RULES 2-4 â€” Cache check inside streaming for NDJSON consistency  */
      /* ---------------------------------------------------------------- */
      const cachedEpisode = await findCachedEpisode(episodeId);
      if (cachedEpisode) {
        await send({
          type: "status",
          message: "Extracting cached timeline matrices...",
        });

        const rawTranscript = cachedEpisode.segments
          .map((s) => s.text)
          .join("\n\n");
        const metadata: ScrapedMetadata = {
          episodeTitle: cachedEpisode.title,
          showName: "",
        };

        let transcript = rawTranscript;
        let adFiltered = false;
        if (filterAdsFlag) {
          await send({
            type: "status",
            message: "Filtering advertisements...",
          });
          try {
            const filtered = await filterAds(openai, rawTranscript, cachedEpisode.segments);
            transcript = filtered.text;
            adFiltered = true;
            if (filtered.segments.length > 0) {
              cachedEpisode.segments.length = 0;
              cachedEpisode.segments.push(...filtered.segments);
            }
          } catch {
            adFiltered = false;
          }
        }

        console.log(
          `[Cache] HIT for episode ${episodeId} â€” delaying 10s to mask cache behavior`
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
            adFiltered,
            executionTime: cachedEpisode.executionTime,
          },
        });
        // Add to this user's transcription history and deduct a credit for PayGo
        addTranscription(email, {
          id: episodeId,
          episodeTitle: cachedEpisode.title,
          spotifyUrl: trimmedUrl,
          timestamp: new Date().toISOString(),
          executionTime: cachedEpisode.executionTime,
        }).catch(() => {});
        await deductCredit(email);
return; /* early exit â€” finally block handles lock cleanup */
      }

      /* ---------------------------------------------------------------- */
      /* YOUTUBE â€” try native captions first, fall back to audio DL      */
      /* ---------------------------------------------------------------- */
      if (false) {
        /* YOUTUBE â€” disabled; effectiveMode forces Spotify pipeline
        ...
        Entire YouTube handler code is commented out to bypass TS strict-null checks.
        ... */
      }

      /* ---------------------------------------------------------------- */
      /* APPLE â€” iTunes lookup â†’ direct audio stream â†’ transcribe         */
      /* ---------------------------------------------------------------- */
      if (false) {
        /* APPLE â€” disabled; effectiveMode forces Spotify pipeline
        ...
        Entire Apple handler code is commented out to bypass TS strict-null checks.
        ... */
      }

      /* ---------------------------------------------------------------- */
      /* SPOTIFY (default) â€” oEmbed â†’ RSS â†’ audio â†’ transcribe           */
      /* ---------------------------------------------------------------- */

      // --- Step A: Scrape metadata ---
      await send({ type: "status", message: "Fetching episode metadata..." });
      const metadata = await scrapeSpotifyEpisode(trimmedUrl);
      if (!metadata) {
        await send({ type: "error", error: "Could not find episode metadata on that Spotify page." });
        return;
      }

      // --- Step B: Parallel RSS feed resolution (iTunes + Podcast Index) ---
      await send({ type: "status", message: "Resolving RSS feed via multiple sources..." });
      let rssFeedUrl: string | null = null;
      let rssResult: RssFeedResult;

      // Run both searches in parallel, allow one to fail silently
      const [itunesResult, piResult] = await Promise.allSettled([
        findRssFeed(metadata.showName, metadata.episodeTitle),
        findViaPodcastIndex(metadata.showName, metadata.episodeTitle),
      ]);

      // Extract results, treating rejected promises as "not found"
      const itunesRss: RssFeedResult = itunesResult.status === "fulfilled"
        ? itunesResult.value
        : { found: false as const, reason: "no-match" as const };
      const piRss: RssFeedResult = piResult.status === "fulfilled"
        ? piResult.value
        : { found: false as const, reason: "no-match" as const };

      rssResult = pickBestResult(itunesRss, piRss, metadata.showName);

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
      let episodeDescription: string | undefined;

      if (directAudioUrl) {
        episodeFound = true;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "st-"));
        const inputPath = path.join(tmpDir, "input.mp3");
        console.log("-> Starting memory-isolated download stream to disk...");
        await streamAudioToDisk(directAudioUrl, inputPath);
        audioFileProcessed = true;
      } else if (rssFeedUrl) {
        try {
          const episode = await findEpisodeInFeed(rssFeedUrl, metadata.episodeTitle, episodeId);
          if (episode?.enclosureUrl) {
            episodeFound = true;
            episodeDescription = episode.description;
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

      // --- Duration check: reject episodes over 5 hours ---
      await send({ type: "status", message: "Checking audio duration..." });
      const inputPath = path.join(tmpDir, "input.mp3");
      const duration = await getAudioDuration(inputPath).catch(() => 0);
      const MAX_DURATION = 5 * 3600;
      if (duration > MAX_DURATION) {
        await send({
          type: "error",
          error: "This episode is " + (duration / 3600).toFixed(1) + " hours long, which exceeds the 5-hour limit.",
          detail: "Transcribe a shorter episode or upgrade to a higher plan for longer content.",
        });
        return;
      }
      console.log("-> Audio duration:", (duration / 60).toFixed(1), "min (" + duration.toFixed(0) + "s)");

      // --- Steps D-F: split, transcribe, filter (shared with Apple path) ---
      await send({ type: "status", message: "Processing audio segments..." });
      console.log("-> Splitting file segments directly via system execution binaries...");
      const chunkInfos = await splitAudioIntoChunksOnDisk(inputPath, tmpDir, duration);
      const total = chunkInfos.length;
      console.log(`-> Architecture split mapped into ${total} isolated segments`);
      await send({ type: "chunks", count: total });

      const transcripts: string[] = new Array(total);
      for (let i = 0; i < total; i += MAX_CONCURRENT_TRANSCRIBERS) {
        const slice = chunkInfos.slice(i, i + MAX_CONCURRENT_TRANSCRIBERS);
        await Promise.all(
          slice.map(async (chunkInfo, sliceIndex) => {
            const globalIndex = i + sliceIndex;
            console.log(`-> Spinning worker payload channel for segment index: ${globalIndex + 1}/${total}`);
            transcripts[globalIndex] = await transcribeChunk(chunkInfo.path, globalIndex + 1, total);
          })
        );
      }

      const rawText = transcripts.join("\n\n");
      console.log("-> Stitched transcript:", rawText.length, "chars across", total, "chunks");
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      tmpDir = "";

      const finalSegments: TranscriptSegment[] = transcripts.map(
        (text, i) => ({
          start: chunkInfos[i].startTime,
          end: chunkInfos[i].startTime + chunkInfos[i].duration,
          text,
        })
      );

      let finalText = rawText;
      let adFiltered = false;
      if (filterAdsFlag) {
        await send({ type: "status", message: "Filtering advertisements..." });
        try {
          const filtered = await filterAds(openai, rawText, finalSegments, episodeDescription);
          finalText = filtered.text;
          adFiltered = true;
          if (filtered.segments.length > 0) {
            // Replace finalSegments with the ad-filtered version
            finalSegments.length = 0;
            finalSegments.push(...filtered.segments);
          }
        } catch {
          adFiltered = false;
        }
      }
      const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
      const estimatedCost = total * 0.000333;
      console.log(`ðŸ’° Estimated OpenRouter Cost: $${estimatedCost.toFixed(6)}`);
      console.log(`==================================================`);

      /* ---------------------------------------------------------------- */
      /* SEQUENTIAL SYNC: Save to Teable BEFORE sending the result token.  */
      /* This guarantees the database write completes while the stream is  */
      /* still open and the platform runtime cannot cut us off.            */
      /* ---------------------------------------------------------------- */
      console.log("ðŸ“¡ [Pipeline Sync Complete] Safely committing records straight to Teable...");
      await saveEpisodeRecord({
        episodeId,
        episodeTitle: metadata.episodeTitle,
        segments: finalSegments,
        executionTime: Number(elapsedSeconds),
        email: session?.user?.email ?? undefined,
        timestamp: new Date().toISOString(),
      });

      // Deduct a credit for PayGo users
      if (session?.user?.email) {
        await deductCredit(session.user.email);
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
      /* RULE 5 â€” Release the processing lock so future requests can proceed */
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
