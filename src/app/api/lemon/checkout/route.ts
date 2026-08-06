import { NextRequest, NextResponse } from "next/server";
import { createCheckoutUrl, type LemonMode } from "@/lib/lemon-squeezy";

export async function POST(req: NextRequest) {
  try {
    const { variantId, email, mode: rawMode } = await req.json();
    const mode: LemonMode = rawMode === "test" ? "test" : "live";

    if (!variantId || !email) {
      return NextResponse.json({ error: "Missing variantId or email" }, { status: 400 });
    }

    const url = await createCheckoutUrl(variantId, email, mode);
    if (!url) {
      return NextResponse.json({ error: "Failed to create checkout URL" }, { status: 500 });
    }

    return NextResponse.json({ url, mode });
  } catch (err) {
    console.error("[Lemon Checkout] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}