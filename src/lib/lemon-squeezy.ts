/* ------------------------------------------------------------------ */
/* Lemon Squeezy integration — checkout creation & webhook verification */
/* Docs: https://docs.lemonsqueezy.com/api                             */
/* ------------------------------------------------------------------ */

export type LemonMode = "test" | "live";

const LEMON_API_BASE = "https://api.lemonsqueezy.com/v1";

/* ------------------------------------------------------------------ */
/* Config helpers — selects test or live env vars                      */
/* ------------------------------------------------------------------ */

function prefix(mode: LemonMode): string {
  return mode === "test" ? "LEMON_SQUEEZY_TEST" : "LEMON_SQUEEZY_LIVE";
}

function getApiKey(mode: LemonMode): string {
  const key = process.env[`${prefix(mode)}_API_KEY`]
    ?? process.env.LEMON_SQUEEZY_API_KEY;
  if (!key) throw new Error(`Lemon Squeezy API key not configured for ${mode} mode.`);
  return key;
}

function getStoreId(mode: LemonMode): string {
  const id = process.env[`${prefix(mode)}_STORE_ID`];
  if (!id) throw new Error(`Lemon Squeezy store ID not configured for ${mode} mode.`);
  return id;
}

function getWebhookSecret(mode: LemonMode): string {
  const secret = process.env[`${prefix(mode)}_WEBHOOK_SECRET`];
  if (!secret) throw new Error(`Lemon Squeezy webhook secret not configured for ${mode} mode.`);
  return secret;
}

/* ------------------------------------------------------------------ */
/* HTTP client                                                         */
/* ------------------------------------------------------------------ */

async function lemonFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${LEMON_API_BASE}${path}`, {
    ...options,
    headers: {
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
  mode: LemonMode;
  envVar: string;
}

export interface ProVariant {
  pods: number;
  pricePerPod: number;
  monthlyPrice: number;
  mode: LemonMode;
  envVar: string;
}

export const PAYGO_VARIANTS: PayGoVariant[] = [
  { price: 5, credits: 16, mode: "live", envVar: "LEMON_SQUEEZY_LIVE_VARIANT_PAYGO_5" },
  { price: 10, credits: 33, mode: "live", envVar: "LEMON_SQUEEZY_LIVE_VARIANT_PAYGO_10" },
  { price: 20, credits: 66, mode: "live", envVar: "LEMON_SQUEEZY_LIVE_VARIANT_PAYGO_20" },
  { price: 30, credits: 100, mode: "live", envVar: "LEMON_SQUEEZY_LIVE_VARIANT_PAYGO_30" },
  { price: 5, credits: 16, mode: "test", envVar: "LEMON_SQUEEZY_TEST_VARIANT_PAYGO_5" },
  { price: 10, credits: 33, mode: "test", envVar: "LEMON_SQUEEZY_TEST_VARIANT_PAYGO_10" },
  { price: 20, credits: 66, mode: "test", envVar: "LEMON_SQUEEZY_TEST_VARIANT_PAYGO_20" },
  { price: 30, credits: 100, mode: "test", envVar: "LEMON_SQUEEZY_TEST_VARIANT_PAYGO_30" },
];

export function getProTier(pods: number): number {
  if (pods <= 30) return 0.17;
  if (pods <= 75) return 0.14;
  return 0.11;
}

export function buildProVariants(mode: LemonMode): ProVariant[] {
  const variants: ProVariant[] = [];
  const p = mode === "test" ? "LEMON_SQUEEZY_TEST" : "LEMON_SQUEEZY_LIVE";
  for (let pods = 10; pods <= 50; pods += 5) {
    const pricePerPod = getProTier(pods);
    variants.push({
      pods,
      pricePerPod,
      monthlyPrice: Math.round(pods * pricePerPod * 100) / 100,
      mode,
      envVar: `${p}_VARIANT_PRO_${pods}`,
    });
  }
  variants.unshift({
    pods: 6,
    pricePerPod: 0.17,
    monthlyPrice: 1.02,
    mode,
    envVar: `${p}_VARIANT_PRO_6`,
  });
  return variants;
}

export const PRO_VARIANTS: ProVariant[] = [
  ...buildProVariants("live"),
  ...buildProVariants("test"),
];

/** Get the Lemon Squeezy variant ID for a PayGo product by credit amount. */
export function getPayGoVariantId(credits: number, mode: LemonMode): string | null {
  const variant = PAYGO_VARIANTS.find((v) => v.credits === credits && v.mode === mode);
  if (!variant) return null;
  return process.env[variant.envVar] ?? null;
}

/** Get the Lemon Squeezy variant ID for a Pro plan by pod count. */
export function getProVariantId(pods: number, mode: LemonMode): string | null {
  const prefix = mode === "test" ? "LEMON_SQUEEZY_TEST" : "LEMON_SQUEEZY_LIVE";
  const envVar = `${prefix}_VARIANT_PRO_${pods}`;
  return process.env[envVar] ?? null;
}

/* ------------------------------------------------------------------ */
/* Create a Lemon Squeezy checkout URL                                 */
/* ------------------------------------------------------------------ */

export async function createCheckoutUrl(
  variantId: string,
  email: string,
  mode: LemonMode,
): Promise<string> {
  const apiKey = getApiKey(mode);
  const storeId = getStoreId(mode);

  const data = await lemonFetch("/checkouts", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email,
          },
          test_mode: mode === "test",
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
  secret: string,
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

const _variantIdMap = new Map<string, { type: "paygo" | "pro"; pods?: number; credits?: number; mode: LemonMode }>();

function _buildVariantIdMap(): void {
  if (_variantIdMap.size > 0) return;
  for (const v of PAYGO_VARIANTS) {
    const id = process.env[v.envVar];
    if (id) _variantIdMap.set(id, { type: "paygo", credits: v.credits, mode: v.mode });
  }
  for (const v of PRO_VARIANTS) {
    const id = process.env[v.envVar];
    if (id) _variantIdMap.set(id, { type: "pro", pods: v.pods, mode: v.mode });
  }
}

export function identifyVariant(variantId: string): {
  type: "paygo" | "pro" | "unknown";
  pods?: number;
  credits?: number;
  mode?: LemonMode;
} {
  _buildVariantIdMap();
  return _variantIdMap.get(variantId) ?? { type: "unknown" };
}