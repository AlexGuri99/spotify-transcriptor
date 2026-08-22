import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, ApiAuthError } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import {
  runTranscriptionPipeline,
  EPISODE_ID_RE,
  inProgressEpisodeIds,
} from "@/lib/transcription-pipeline";
import { deductCredit } from "@/lib/usage-tracker";
import { type UserPlan } from "@/lib/rate-limiter";

/* ------------------------------------------------------------------ */
/* Request schema                                                      */
/* ------------------------------------------------------------------ */

interface TranscribeRequestBody {
  url: string;
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/transcribe                                             */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest): Promise<Response> {
  // Parse body
  let body: TranscribeRequestBody;
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

  // Dedup — prevent parallel transcription of the same episode
  if (inProgressEpisodeIds.has(episodeId)) {
    return NextResponse.json(
      { error: "This episode is currently being transcribed. Please wait." },
      { status: 409 }
    );
  }
  inProgressEpisodeIds.add(episodeId);

  try {
    const result = await runTranscriptionPipeline({
      url: trimmedUrl,
      filterAds: true,
      email: user.email,
      episodeId,
    });

    // Deduct credit for non-free plans
    if (plan !== "free") {
      deductCredit(user.email).catch(() => {});
    }

    return NextResponse.json({
      data: {
        metadata: result.metadata,
        rss_feed_url: result.rssFeedUrl,
        transcript: result.transcript,
        segments: result.segments,
        ad_filtered: result.adFiltered,
        execution_time: result.executionTime,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Transcription failed." },
      { status: 500 }
    );
  } finally {
    inProgressEpisodeIds.delete(episodeId);
  }
}