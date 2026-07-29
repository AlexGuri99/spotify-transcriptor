import { NextResponse } from "next/server";
import { PAYGO_PRODUCTS, PRO_PRODUCTS, getPayGoProductId, getProProductId } from "@/lib/whop-products";

export async function GET() {
  const paygo = PAYGO_PRODUCTS.map((p) => ({
    price: p.price,
    credits: p.credits,
    productId: getPayGoProductId(p.credits),
  })).filter((p) => p.productId);

  const pro = PRO_PRODUCTS.map((p) => ({
    pods: p.pods,
    pricePerPod: p.pricePerPod,
    monthlyPrice: p.monthlyPrice,
    productId: getProProductId(p.pods),
  })).filter((p) => p.productId);

  return NextResponse.json({ paygo, pro });
}