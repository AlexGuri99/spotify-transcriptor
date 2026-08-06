import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

const LS_API_BASE = "https://api.lemonsqueezy.com/v1";

async function lsFetch(path: string) {
  const key = process.env.LEMON_SQUEEZY_API_KEY;
  if (!key) throw new Error("LEMON_SQUEEZY_API_KEY not configured");

  const res = await fetch(`${LS_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ urls: null });
  }

  const email = encodeURIComponent(session.user.email);

  // Fetch subscriptions for this user
  const subsData = await lsFetch(`/subscriptions?filter[user_email]=${email}&page[size]=5`);
  const subscriptions = (subsData?.data ?? [])
    .filter((s: any) => s.attributes.status === "active" || s.attributes.status === "paused")
    .map((s: any) => ({
      id: s.id,
      productName: s.attributes.product_name,
      variantName: s.attributes.variant_name,
      status: s.attributes.status,
      renewsAt: s.attributes.renews_at,
      urls: s.attributes.urls,
    }));

  // Fetch recent orders for this user
  const ordersData = await lsFetch(`/orders?filter[user_email]=${email}&page[size]=5`);
  const orders = (ordersData?.data ?? [])
    .filter((o: any) => o.attributes.status === "paid")
    .map((o: any) => ({
      id: o.id,
      orderNumber: o.attributes.order_number,
      totalFormatted: o.attributes.total_formatted,
      productName: o.attributes.first_order_item?.product_name,
      createdAt: o.attributes.created_at,
      receiptUrl: o.attributes.urls?.receipt,
    }));

  // Best URL to show: customer portal if subscribed, or receipt URL if PayGo
  const primaryUrl = subscriptions[0]?.urls?.customer_portal
    ?? orders[0]?.receiptUrl
    ?? null;

  return NextResponse.json({
    urls: primaryUrl
      ? {
          customerPortal: primaryUrl,
          updatePaymentMethod: subscriptions[0]?.urls?.update_payment_method ?? null,
          updateSubscription: subscriptions[0]?.urls?.customer_portal_update_subscription ?? null,
        }
      : null,
    subscriptions,
    orders,
  });
}