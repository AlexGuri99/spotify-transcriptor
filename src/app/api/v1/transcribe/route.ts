import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, ApiAuthError } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import {
  runTranscriptionPipeline,
  EPISODE_ID_RE,
  inProgressEpisodeIds,
} from "@/lib/transcription-pipeline";
import { deductCredit } from "@/lib/usage-tracker";
import { findCachedEpisode } from "@/lib/teable";
import { type UserPlan } from "@/lib/rate-limiter";

/* ------------------------------------------------------------------ */
/* POST /api/v1/transcribe — async, returns immediately               */
/*                                                                     */
/*   - Already cached? → return cached transcript                      */
/*   - Already in progress? → return {"status": "processing"}          */
/*   - New job? → fire pipeline in background, return 202 Accepted     */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest): Promise<Response> {
  // Parse body
  let body: { url: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body." },
      { status: 400 }
    );
  }

  const { url } = body;

  if (!url || typeof url !== "string" || !url.trim()) {
    return NextResponse.json(
      { error: "Missing or invalid 'url' in request body." },
      { status: 400 }
    );
  }

  const trimmedUrl = url.trim();

  // Auth
  let user;
  try {
    user = await authenticateRequest(req);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
  }

  // Rate limiting (plan-aware)
  const plan = user.plan as UserPlan;
  const rateLimit = checkRateLimit(user.email, plan);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": plan === "free" ? "5" : plan === "credits" ? "10" : "30",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rateLimit.resetAt),
        },
      }
    );
  }

  // Extract episode ID
  const episodeIdMatch = trimmedUrl.match(EPISODE_ID_RE);
  const episodeId = episodeIdMatch?.[1] ?? null;
  if (!episodeId) {
    return NextResponse.json(
      { error: "Could not recognize the URL format. Expected a Spotify episode link." },
      { status: 400 }
    );
  }

  // Already cached? Return immediately
  const cached = await findCachedEpisode(episodeId);
  if (cached) {
    return NextResponse.json({
      status: "completed",
      episode_id: episodeId,
      data: {
        title: cached.title,
        segments: cached.segments,
        execution_time: cached.executionTime,
      },
    });
  }

  // Already in progress? Let the caller know
  if (inProgressEpisodeIds.has(episodeId)) {
    return NextResponse.json({
      status: "processing",
      episode_id: episodeId,
    });
  }

  // Check credit balance for non-free plans
  const { getUserData } = await import("@/lib/usage-tracker");
  if (plan !== "free") {
    const userData = await getUserData(user.email);
    if (userData.creditsRemaining <= 0) {
      return NextResponse.json(
        { error: "You're out of credits." },
        { status: 402 }
      );
    }
  }

  // Fire the pipeline in the background
  inProgressEpisodeIds.add(episodeId);

  const executionPromise = (async () => {
    try {
      await runTranscriptionPipeline({
        url: trimmedUrl,
        filterAds: true,
        email: user.email,
        episodeId,
      });

      // Deduct credit for non-free plans
      if (plan !== "free") {
        await deductCredit(user.email);
      }
    } catch (err: any) {
      console.error(`[v1/transcribe] Pipeline failed for ${episodeId}:`, err?.message);
    } finally {
      inProgressEpisodeIds.delete(episodeId);
    }
  })();

  // keep the runtime alive until the pipeline finishes
  const waitUntil = (req as any).waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil(executionPromise);
  }

  return NextResponse.json(
    { status: "accepted", episode_id: episodeId },
    { status: 202 }
  );
}