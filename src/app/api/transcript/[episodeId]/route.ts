import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { findCachedEpisode } from "@/lib/teable";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ episodeId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { episodeId } = await params;
  if (!episodeId || !/^[a-zA-Z0-9]{22}$/.test(episodeId)) {
    return NextResponse.json({ error: "Invalid episode ID" }, { status: 400 });
  }

  const cached = await findCachedEpisode(episodeId);
  if (!cached) {
    return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
  }

  return NextResponse.json(cached);
}