import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const oembed = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembed, { headers: { Accept: "application/json" } });
    if (!res.ok) return NextResponse.json({ thumbnailUrl: null });

    const data: any = await res.json();
    return NextResponse.json({ thumbnailUrl: data.thumbnail_url ?? null });
  } catch {
    return NextResponse.json({ thumbnailUrl: null });
  }
}