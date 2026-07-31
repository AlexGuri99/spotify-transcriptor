/* ------------------------------------------------------------------ */
/* Lemon Squeezy integration — checkout creation & webhook verification */
/* Docs: https://docs.lemonsqueezy.com/api                             */
/* ------------------------------------------------------------------ */

const LEMON_API_BASE = "https://api.lemonsqueezy.com/v1";

function requireConfig() {
  const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
  if (!apiKey) throw new Error("LEMON_SQUEEZY_API_KEY is not configured.");
  return apiKey;
}

async function lemonFetch(path: string, options?: RequestInit) {
  const apiKey = requireConfig();
  const res = await fetch(`${LEMON_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Lemon API error (HTTP ${res.status}): ${body}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Product variant ID mapping — same structure as the Whop version     */
/* ------------------------------------------------------------------ */

export interface PayGoVariant {
  price: number;
  credits: number;
  envVar: string;
}

export interface ProVariant {
  pods: number;
  pricePerPod: number;
  monthlyPrice: number;
  envVar: string;
}

export const PAYGO_VARIANTS: PayGoVariant[] = [
  { price: 5, credits: 16, envVar: "LEMON_SQUEEZY_VARIANT_PAYGO_5" },
  { price: 10, credits: 33, envVar: "LEMON_SQUEEZY_VARIANT_PAYGO_10" },
  { price: 20, credits: 66, envVar: "LEMON_SQUEEZY_VARIANT_PAYGO_20" },
  { price: 30, credits: 100, envVar: "LEMON_SQUEEZY_VARIANT_PAYGO_30" },
];

export function getProTier(pods: number): number {
  if (pods <= 30) return 0.17;
  if (pods <= 75) return 0.14;
  return 0.11;
}

export const PRO_VARIANTS: ProVariant[] = [];
for (let pods = 10; pods <= 120; pods += 5) {
  const pricePerPod = getProTier(pods);
  PRO_VARIANTS.push({
    pods,
    pricePerPod,
    monthlyPrice: Math.round(pods * pricePerPod * 100) / 100,
    envVar: `LEMON_SQUEEZY_VARIANT_PRO_${pods}`,
  });
}
PRO_VARIANTS.unshift({
  pods: 6,
  pricePerPod: 0.17,
  monthlyPrice: 1.02,
  envVar: "LEMON_SQUEEZY_VARIANT_PRO_6",
});

/** Get the Lemon Squeezy variant ID for a PayGo product by credit amount. */
export function getPayGoVariantId(credits: number): string | null {
  const variant = PAYGO_VARIANTS.find((v) => v.credits === credits);
  if (!variant) return null;
  return process.env[variant.envVar] ?? null;
}

/** Get the Lemon Squeezy variant ID for a Pro plan by pod count. */
export function getProVariantId(pods: number): string | null {
  const variant = PRO_VARIANTS.find((v) => v.pods === pods);
  if (!variant) return null;
  return process.env[variant.envVar] ?? null;
}

/* ------------------------------------------------------------------ */
/* Create a Lemon Squeezy checkout URL                                 */
/* ------------------------------------------------------------------ */

export async function createCheckoutUrl(
  variantId: string,
  email: string,
  storeId: string
): Promise<string> {
  const data = await lemonFetch("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email,
          },
        },
        relationships: {
          store: {
            data: { type: "stores", id: storeId },
          },
          variant: {
            data: { type: "variants", id: variantId },
          },
        },
      },
    }),
  });

  return (data as any).data?.attributes?.url ?? "";
}

/* ------------------------------------------------------------------ */
/* Webhook signature verification                                      */
/* ------------------------------------------------------------------ */

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const crypto = require("crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/* ------------------------------------------------------------------ */
/* Variant ID → plan identification (for webhook processing)           */
/* ------------------------------------------------------------------ */

const _variantIdMap = new Map<string, { type: "paygo" | "pro"; pods?: number; credits?: number }>();

function _buildVariantIdMap(): void {
  if (_variantIdMap.size > 0) return;
  for (const v of PAYGO_VARIANTS) {
    const id = process.env[v.envVar];
    if (id) _variantIdMap.set(id, { type: "paygo", credits: v.credits });
  }
  for (const v of PRO_VARIANTS) {
    const id = process.env[v.envVar];
    if (id) _variantIdMap.set(id, { type: "pro", pods: v.pods });
  }
}

export function identifyVariant(variantId: string): {
  type: "paygo" | "pro" | "unknown";
  pods?: number;
  credits?: number;
} {
  _buildVariantIdMap();
  return _variantIdMap.get(variantId) ?? { type: "unknown" };
}