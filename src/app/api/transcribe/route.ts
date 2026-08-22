import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { findCachedEpisode, saveEpisodeRecord } from "@/lib/teable";
import { getUsageStats, deductCredit, getUserData, addTranscription } from "@/lib/usage-tracker";
import { findViaPodcastIndex } from "@/lib/podcast-index";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import {
  ScrapedMetadata,
  TranscriptSegment,
  RssFeedResult,
  EPISODE_ID_RE,
  inProgressEpisodeIds,
  createOpenRouterClient,
  scrapeSpotifyEpisode,
  findRssFeed,
  findEpisodeInFeed,
  streamAudioToDisk,
  getAudioDuration,
  splitAudioIntoChunksOnDisk,
  transcribeChunk,
  filterAdsByPattern,
  filterAds,
} from "@/lib/transcription-pipeline";

/* ------------------------------------------------------------------ */
/* Rate limiting — sliding window per IP (session-based route only)  */
/* ------------------------------------------------------------------ */

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
  /* Anonymous users must sign up — no free transcriptions without auth */
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
  /* Free plan monthly limit — 5 transcriptions per month              */
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
  /* Extract the 22-character Spotify episode ID from the URL           */
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
  /* Prevent parallel processing                                        */
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

  inProgressEpisodeIds.add(episodeId);
  console.log(`[Lock] Acquired for episode ${episodeId}`);

  // --- Proceed with streaming NDJSON ---
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = (data: Record<string, unknown>) =>
    writer.write(encoder.encode(JSON.stringify(data) + "\n"));

  const executionPromise = (async () => {
    try {
      /* ---------------------------------------------------------------- */
      /* Cache check — return cached result if available                  */
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
            const openai = createOpenRouterClient();
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
            adFiltered,
            executionTime: cachedEpisode.executionTime,
          },
        });
        addTranscription(email, {
          id: episodeId,
          episodeTitle: cachedEpisode.title,
          spotifyUrl: trimmedUrl,
          timestamp: new Date().toISOString(),
          executionTime: cachedEpisode.executionTime,
        }).catch(() => {});
        await deductCredit(email);
        return;
      }

      /* ---------------------------------------------------------------- */
      /* Spotify — oEmbed → RSS → audio → transcribe                     */
      /* ---------------------------------------------------------------- */

      await send({ type: "status", message: "Fetching episode metadata..." });
      const metadata = await scrapeSpotifyEpisode(trimmedUrl);
      if (!metadata) {
        await send({ type: "error", error: "Could not find episode metadata on that Spotify page." });
        return;
      }

      // --- Parallel RSS feed resolution (iTunes + Podcast Index) ---
      await send({ type: "status", message: "Resolving RSS feed via multiple sources..." });
      let rssResult: RssFeedResult;

      const [itunesResult, piResult] = await Promise.allSettled([
        findRssFeed(metadata.showName, metadata.episodeTitle),
        findViaPodcastIndex(metadata.showName, metadata.episodeTitle),
      ]);

      const itunesRss: RssFeedResult = itunesResult.status === "fulfilled"
        ? itunesResult.value
        : { found: false as const, reason: "no-match" as const };
      const piRss: RssFeedResult = piResult.status === "fulfilled"
        ? piResult.value
        : { found: false as const, reason: "no-match" as const };

      rssResult = piRss.found ? piRss : itunesRss;

      if (!rssResult.found) {
        if (rssResult.reason === "empty-results") {
          await send({ type: "error", error: "Show could not be resolved via public directories (Potential Spotify Exclusive)." });
        } else if (rssResult.reason === "unknown-show") {
          await send({ type: "error", error: "This episode could not be located in public directories and is likely a Spotify Exclusive show." });
        }
        return;
      }

      const rssFeedUrl = rssResult.feedUrl || null;
      if (rssFeedUrl) console.log("-> Parsed RSS URL:", rssFeedUrl);

      // --- Download audio ---
      await send({ type: "status", message: "Downloading audio..." });
      const directAudioUrl = rssResult.directAudioUrl;
      let episodeDescription: string | undefined;
      let audioFileProcessed = false;
      let tmpDir = "";

      if (directAudioUrl) {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "st-"));
        console.log("-> Starting memory-isolated download stream to disk...");
        await streamAudioToDisk(directAudioUrl, path.join(tmpDir, "input.mp3"));
        audioFileProcessed = true;
      } else if (rssFeedUrl) {
        try {
          const episode = await findEpisodeInFeed(rssFeedUrl, metadata.episodeTitle, episodeId);
          if (episode?.enclosureUrl) {
            episodeDescription = episode.description;
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "st-"));
            console.log("-> Starting memory-isolated download stream to disk...");
            await streamAudioToDisk(episode.enclosureUrl, path.join(tmpDir, "input.mp3"));
            audioFileProcessed = true;
          }
        } catch {
          /* couldn't find episode in feed */
        }
      }

      if (!audioFileProcessed) {
        await send({
          type: "error",
          error: "Could not locate or download the audio for this episode.",
        });
        return;
      }

      const inputPath = path.join(tmpDir, "input.mp3");

      // --- Duration check ---
      await send({ type: "status", message: "Checking audio duration..." });
      const duration = await getAudioDuration(inputPath).catch(() => 0);
      const MAX_DURATION = 5 * 3600;
      if (duration > MAX_DURATION) {
        await send({
          type: "error",
          error: "This episode is " + (duration / 3600).toFixed(1) + " hours long, which exceeds the 5-hour limit.",
        });
        return;
      }

      // --- Split & transcribe ---
      await send({ type: "status", message: "Processing audio segments..." });
      const chunkInfos = await splitAudioIntoChunksOnDisk(inputPath, tmpDir, duration);
      const total = chunkInfos.length;
      await send({ type: "chunks", count: total });

      const transcripts: string[] = new Array(total);
      for (let i = 0; i < total; i += 3) {
        const slice = chunkInfos.slice(i, i + 3);
        await Promise.all(
          slice.map(async (chunkInfo, sliceIndex) => {
            const globalIndex = i + sliceIndex;
            transcripts[globalIndex] = await transcribeChunk(chunkInfo.path, globalIndex + 1, total);
          })
        );
      }

      const rawText = transcripts.join("\n\n");
      const finalSegments: TranscriptSegment[] = transcripts.map(
        (text, i) => ({
          start: chunkInfos[i].startTime,
          end: chunkInfos[i].startTime + chunkInfos[i].duration,
          text,
        })
      );
      const originalSegmentCount = finalSegments.length;

      // --- Ad filtering ---
      let finalText = rawText;
      let adFiltered = false;
      let kept: TranscriptSegment[] = [];
      let removed = 0;

      if (filterAdsFlag) {
        await send({ type: "status", message: "Filtering advertisements..." });

        const result = filterAdsByPattern(finalSegments);
        kept = result.kept;
        removed = result.removed;

        if (kept.length === 0) {
          finalSegments.length = 0;
          finalText = "";
          adFiltered = true;
        } else {
          try {
            const openai = createOpenRouterClient();
            const remainingText = kept.map((s) => s.text).join("\n\n");
            const filtered = await filterAds(openai, remainingText, kept, episodeDescription);
            finalText = filtered.text;
            adFiltered = true;
            if (filtered.segments.length > 0) {
              finalSegments.length = 0;
              finalSegments.push(...filtered.segments);
            }
          } catch {
            if (removed > 0) {
              finalSegments.length = 0;
              finalSegments.push(...kept);
              finalText = kept.map((s) => s.text).join("\n\n");
              adFiltered = true;
            }
          }
        }
      }

      const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

      // --- Save to Teable ---
      await saveEpisodeRecord({
        episodeId,
        episodeTitle: metadata.episodeTitle,
        segments: finalSegments,
        executionTime: Number(elapsedSeconds),
        email: session?.user?.email ?? undefined,
        timestamp: new Date().toISOString(),
        logs: {
          source: rssResult?.found ? (rssResult.directAudioUrl ? "direct-audio" : "rss-parse") : "none",
          audioUrl: rssResult?.found ? rssResult.directAudioUrl || rssFeedUrl : null,
          chunkCount: chunkInfos?.length ?? null,
          audioDuration: duration ? Math.round(duration) : null,
          adFilterStage: !filterAdsFlag ? "disabled" : (typeof removed === "number" && kept?.length === 0 ? "pattern-only" : adFiltered ? "pattern+llm" : "llm-failed"),
          segmentsRemovedByPattern: typeof removed === "number" ? removed : 0,
          segmentsAfterFilter: finalSegments.length,
          segmentsBeforeFilter: originalSegmentCount,
        },
      });

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
      inProgressEpisodeIds.delete(episodeId);
      console.log(`[Lock] Released for episode ${episodeId}`);
      try { await writer.close(); } catch { /* stream already closed */ }
    }
  })();

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