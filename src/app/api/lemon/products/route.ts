import { NextResponse } from "next/server";
import { PAYGO_VARIANTS, PRO_VARIANTS, getPayGoVariantId, getProVariantId } from "@/lib/lemon-squeezy";

export async function GET() {
  const paygo = PAYGO_VARIANTS.map((v) => ({
    price: v.price,
    credits: v.credits,
    variantId: getPayGoVariantId(v.credits),
  })).filter((v) => v.variantId);

  const pro = PRO_VARIANTS.map((v) => ({
    pods: v.pods,
    pricePerPod: v.pricePerPod,
    monthlyPrice: v.monthlyPrice,
    variantId: getProVariantId(v.pods),
  })).filter((v) => v.variantId);

  return NextResponse.json({ paygo, pro });
}