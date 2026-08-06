import { NextRequest, NextResponse } from "next/server";
import {
  PAYGO_VARIANTS,
  buildProVariants,
  getPayGoVariantId,
  getProVariantId,
  type LemonMode,
} from "@/lib/lemon-squeezy";

export async function GET(req: NextRequest) {
  const mode: LemonMode = req.nextUrl.searchParams.get("mode") === "test" ? "test" : "live";

  const paygo = PAYGO_VARIANTS
    .filter((v) => v.mode === mode)
    .map((v) => ({
      price: v.price,
      credits: v.credits,
      variantId: getPayGoVariantId(v.credits, mode),
    }))
    .filter((v) => v.variantId);

  const pro = buildProVariants(mode)
    .map((v) => ({
      pods: v.pods,
      pricePerPod: v.pricePerPod,
      monthlyPrice: v.monthlyPrice,
      variantId: getProVariantId(v.pods, mode),
    }))
    .filter((v) => v.variantId);

  return NextResponse.json({ mode, paygo, pro });
}
