import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, ApiAuthError } from "@/lib/api-auth";
import { findCachedEpisode } from "@/lib/teable";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ episodeId: string }> }
): Promise<Response> {
  let user;
  try {
    user = await authenticateRequest(req);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
  }

  const { episodeId } = await params;

  if (!episodeId || !/^[a-zA-Z0-9]{22}$/.test(episodeId)) {
    return NextResponse.json({ error: "Invalid episode ID." }, { status: 400 });
  }

  const cached = await findCachedEpisode(episodeId);

  if (!cached) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }

  return NextResponse.json({
    title: cached.title,
    segments: cached.segments,
    execution_time: cached.executionTime,
  });
}