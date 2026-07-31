import { NextRequest, NextResponse } from "next/server";
import { createCheckoutUrl } from "@/lib/lemon-squeezy";

export async function POST(req: NextRequest) {
  try {
    const { variantId, email } = await req.json();

    if (!variantId || !email) {
      return NextResponse.json({ error: "Missing variantId or email" }, { status: 400 });
    }

    const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
    if (!storeId) {
      return NextResponse.json({ error: "LEMON_SQUEEZY_STORE_ID not configured" }, { status: 500 });
    }

    const url = await createCheckoutUrl(variantId, email, storeId);
    if (!url) {
      return NextResponse.json({ error: "Failed to create checkout URL" }, { status: 500 });
    }

    return NextResponse.json({ url });
  } catch (err) {
    console.error("[Lemon Checkout] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}