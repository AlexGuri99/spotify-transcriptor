import { NextRequest, NextResponse } from "next/server";
import { identifyVariant, verifyWebhookSignature } from "@/lib/lemon-squeezy";
import { setUserPlan, getUserData } from "@/lib/usage-tracker";

/* ------------------------------------------------------------------ */
/* Idempotency — deduplicate webhook events within a 5-minute window  */
/* ------------------------------------------------------------------ */
const PROCESSED_EVENT_IDS = new Set<string>();
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

function markProcessed(eventId: string) {
  PROCESSED_EVENT_IDS.add(eventId);
  setTimeout(() => PROCESSED_EVENT_IDS.delete(eventId), IDEMPOTENCY_TTL_MS);
}

/* ------------------------------------------------------------------ */
/* Webhook handler                                                    */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  /* ---------------------------------------------------------------- */
  /* Verify webhook signature                                         */
  /* ---------------------------------------------------------------- */
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Lemon Webhook] LEMON_SQUEEZY_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const signature = req.headers.get("x-signature") ?? "";
  const rawBody = await req.text();

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.error("[Lemon Webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  /* ---------------------------------------------------------------- */
  /* Parse the event                                                  */
  /* ---------------------------------------------------------------- */
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName: string = payload.meta?.event_name ?? "";
  const eventId: string = payload.meta?.custom_data?.event_id ?? payload.data?.id ?? "";

  console.log(`[Lemon Webhook] Event: ${eventName}`);

  /* ---------------------------------------------------------------- */
  /* Idempotency                                                      */
  /* ---------------------------------------------------------------- */
  if (eventId && PROCESSED_EVENT_IDS.has(eventId)) {
    console.log(`[Lemon Webhook] ⏭️ Skipping duplicate event ${eventId}`);
    return NextResponse.json({ ok: true, deduped: true });
  }
  if (eventId) markProcessed(eventId);

  /* ---------------------------------------------------------------- */
  /* Extract customer info                                            */
  /* ---------------------------------------------------------------- */
  const customerEmail = payload.data?.attributes?.user_email
    ?? payload.data?.attributes?.customer_email
    ?? payload.data?.attributes?.email
    ?? "";

  /* ---------------------------------------------------------------- */
  /* Process by event type                                            */
  /* ---------------------------------------------------------------- */
  try {
    switch (eventName) {
      /* ------------------------------------------------------------ */
      /* PayGo — one-time payment succeeded                           */
      /* ------------------------------------------------------------ */
      case "order_created": {
        // Lemon Squeezy sends variant IDs in first_order_item.variant_id
        // or order_item.variant_id within the order data
        const variantId = String(
          payload.data?.attributes?.first_order_item?.variant_id
          ?? payload.data?.attributes?.order_item?.variant_id
          ?? ""
        );
        const identified = identifyVariant(variantId);
        console.log(`[Lemon Webhook] order_created — variant: ${variantId}, type: ${identified.type}, credits: ${identified.credits}`);

        if (identified.type === "paygo" && identified.credits) {
          const user = await getUserData(customerEmail);
          const currentCredits = user.creditsRemaining ?? 0;
          await setUserPlan(customerEmail, "credits", currentCredits + identified.credits);
          console.log(
            `[Lemon Webhook] ✅ Added ${identified.credits} credits to ${customerEmail} (${currentCredits} → ${currentCredits + identified.credits})`
          );
        }
        break;
      }

      /* ------------------------------------------------------------ */
      /* Pro subscription events                                      */
      /* ------------------------------------------------------------ */
      case "subscription_created":
      case "subscription_updated": {
        const variantId = String(payload.data?.attributes?.variant_id ?? "");
        const identified = identifyVariant(variantId);
        const status = payload.data?.attributes?.status ?? "";
        console.log(`[Lemon Webhook] ${eventName} — variant: ${variantId}, status: ${status}`);

        if (identified.type === "pro" && identified.pods && status === "active") {
          await setUserPlan(customerEmail, "pro", identified.pods);
          console.log(`[Lemon Webhook] ✅ ${customerEmail} → Pro (${identified.pods} pods)`);
        }
        break;
      }

      case "subscription_cancelled": {
        // Lemon Squeezy sends this when the user cancels their subscription
        // The subscription remains active until the period end
        const variantId = String(payload.data?.attributes?.variant_id ?? "");
        const identified = identifyVariant(variantId);
        const status = payload.data?.attributes?.status ?? "";
        // If status is "cancelled" but not yet expired, the user still has access
        // Only revert to free if the subscription is truly expired
        if (status === "expired" || status === "unpaid") {
          if (identified.type === "pro") {
            await setUserPlan(customerEmail, "free", 0);
            console.log(`[Lemon Webhook] ✅ ${customerEmail} reverted to free (${status})`);
          }
        } else {
          console.log(`[Lemon Webhook] ℹ️ ${customerEmail} cancelled but still active (${status}) — keeping Pro`);
        }
        break;
      }

      case "subscription_expired": {
        const variantId = String(payload.data?.attributes?.variant_id ?? "");
        const identified = identifyVariant(variantId);
        if (identified.type === "pro") {
          await setUserPlan(customerEmail, "free", 0);
          console.log(`[Lemon Webhook] ✅ ${customerEmail} reverted to free (subscription expired)`);
        }
        break;
      }

      default:
        console.log(`[Lemon Webhook] ℹ️ Unhandled event: ${eventName}`);
    }
  } catch (err) {
    console.error(`[Lemon Webhook] Error processing ${eventName}:`, err);
  }

  return NextResponse.json({ ok: true });
}