/* ------------------------------------------------------------------ */
/* Setup Lemon Squeezy products — creates all PayGo & Pro variants     */
/*                                                                    */
/* Usage: node scripts/setup-lemon-products.mjs                       */
/*                                                                    */
/* Requires these env vars (set them in .env first):                   */
/*   LEMON_SQUEEZY_API_KEY                                             */
/*   LEMON_SQUEEZY_LIVE_STORE_ID                                       */
/*   LEMON_SQUEEZY_LIVE_WEBHOOK_SECRET                                 */
/*   LEMON_SQUEEZY_TEST_WEBHOOK_SECRET                                 */
/* ------------------------------------------------------------------ */

const LEMON_API_BASE = "https://api.lemonsqueezy.com/v1";

const API_KEY = process.env.LEMON_SQUEEZY_API_KEY;
const STORE_ID = process.env.LEMON_SQUEEZY_LIVE_STORE_ID;

if (!API_KEY || !STORE_ID) {
  console.error("Missing LEMON_SQUEEZY_API_KEY or LEMON_SQUEEZY_LIVE_STORE_ID in .env");
  process.exit(1);
}

async function ls(path, options = {}) {
  const res = await fetch(`${LEMON_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("API error:", JSON.stringify(body, null, 2));
    throw new Error(`HTTP ${res.status}`);
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* Step 1: Create or find the webhook endpoint                         */
/* ------------------------------------------------------------------ */

async function setupWebhook() {
  console.log("\n--- Setting up webhook ---");

  // Get existing webhooks
  const existing = await ls(`/webhooks?filter[store_id]=${STORE_ID}`);
  const liveHook = existing.data?.find(w => w.attributes?.url?.includes("/api/lemon/webhook"));

  if (liveHook) {
    console.log(`Webhook already exists: ${liveHook.attributes.url} (ID: ${liveHook.id})`);
    return liveHook.id;
  }

  console.log("Creating webhook...");
  console.log("⚠️  Please create the webhook manually in the Lemon Squeezy dashboard:");
  console.log("   Settings → Webhooks → Add webhook");
  console.log("   URL: https://www.tranzkript.com/api/lemon/webhook");
  console.log("   Events: order_created, subscription_created, subscription_updated,");
  console.log("           subscription_cancelled, subscription_expired");
  console.log("   Signing secret: tranzkript.live\n");
  return null;
}

/* ------------------------------------------------------------------ */
/* Step 2: Create PayGo products (one-time purchases)                  */
/* ------------------------------------------------------------------ */

const PAYGO_TIERS = [
  { price: 5,  credits: 16, name: "PayGo 5", description: "16 pods — one-time" },
  { price: 10, credits: 33, name: "PayGo 10", description: "33 pods — one-time" },
  { price: 20, credits: 66, name: "PayGo 20", description: "66 pods — one-time" },
  { price: 30, credits: 100, name: "PayGo 30", description: "100 pods — one-time" },
];

async function createPayGoProducts() {
  console.log("\n--- Creating PayGo products ---");

  const results = {};

  for (const tier of PAYGO_TIERS) {
    // Check if product already exists
    const existing = await ls(`/products?filter[store_id]=${STORE_ID}`);
    const match = existing.data?.find(p =>
      p.attributes.name === tier.name
    );

    let productId;
    if (match) {
      productId = match.id;
      console.log(`  Product "${tier.name}" already exists (ID: ${productId})`);
    } else {
      const created = await ls("/products", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "products",
            attributes: {
              name: tier.name,
              description: tier.description,
              price: tier.price * 100, // cents
              is_subscription: false,
              is_usage_based: false,
              is_license_key: false,
              is_pay_what_you_want: false,
              has_license_keys: false,
              is_limited: false,
            },
            relationships: {
              store: {
                data: { type: "stores", id: STORE_ID },
              },
            },
          },
        }),
      });
      productId = created.data.id;
      console.log(`  Created product "${tier.name}" (ID: ${productId})`);
    }

    // Get the default variant
    const variants = await ls(`/variants?filter[product_id]=${productId}`);
    const variant = variants.data?.[0];
    if (variant) {
      const variantId = variant.id;
      console.log(`  Variant ID: ${variantId}`);
      // Update variant price to match
      const priceCents = tier.price * 100;
      const sku = `paygo-${tier.credits}`;
      await ls(`/variants/${variantId}`, {
        method: "PATCH",
        body: JSON.stringify({
          data: {
            type: "variants",
            id: variantId,
            attributes: {
              name: `${tier.credits} pods`,
              price: priceCents,
              sku,
            },
          },
        }),
      }).catch(() => {});
      console.log(`  Updated variant: $${tier.price} (${tier.credits} pods), SKU: ${sku}`);
      results[`PAYGO_${tier.credits}`] = variantId;
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* Step 3: Create Pro subscription product with tiered pricing         */
/* ------------------------------------------------------------------ */

function getProTier(pods) {
  if (pods <= 30) return 0.17;
  if (pods <= 75) return 0.14;
  return 0.11;
}

const PRO_PODS = [6, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120];

async function createProProduct() {
  console.log("\n--- Creating Pro subscription product ---");

  // Check if Pro product already exists
  const existing = await ls(`/products?filter[store_id]=${STORE_ID}`);
  const match = existing.data?.find(p => p.attributes.name === "Pro");

  let productId;
  if (match) {
    productId = match.id;
    console.log(`  Product "Pro" already exists (ID: ${productId})`);
  } else {
    const created = await ls("/products", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "products",
          attributes: {
            name: "Pro",
            description: "Monthly subscription for power users",
            price: 0,
            is_subscription: true,
            is_usage_based: false,
            is_license_key: false,
            is_pay_what_you_want: false,
            has_license_keys: false,
            is_limited: false,
          },
          relationships: {
            store: {
              data: { type: "stores", id: STORE_ID },
            },
          },
        },
      }),
    });
    productId = created.data.id;
    console.log(`  Created product "Pro" (ID: ${productId})`);
  }

  // Get existing variants
  const existingVariants = await ls(`/variants?filter[product_id]=${productId}`);
  const existingVariantMap = {};
  for (const v of existingVariants.data || []) {
    existingVariantMap[v.attributes.sku] = v.id;
  }

  const results = {};

  for (const pods of PRO_PODS) {
    const pricePerPod = getProTier(pods);
    const monthlyPrice = Math.round(pods * pricePerPod * 100);
    const sku = `pro-${pods}`;

    if (existingVariantMap[sku]) {
      const variantId = existingVariantMap[sku];
      console.log(`  Variant ${sku} already exists (ID: ${variantId})`);
      results[`PRO_${pods}`] = variantId;
      continue;
    }

    // Create a new variant for this pod tier
    // Note: Lemon Squeezy free plan limits how many variants you can create
    // We'll create them and handle errors gracefully
    try {
      const created = await ls("/variants", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "variants",
            attributes: {
              name: `${pods} pods`,
              price: monthlyPrice,
              sku,
              interval: "month",
              interval_count: 1,
              is_subscription: true,
            },
            relationships: {
              product: {
                data: { type: "products", id: productId },
              },
            },
          },
        }),
      });
      const variantId = created.data.id;
      console.log(`  Created variant ${sku}: $${(monthlyPrice / 100).toFixed(2)}/mo (ID: ${variantId})`);
      results[`PRO_${pods}`] = variantId;
    } catch (err) {
      console.error(`  Failed to create variant ${sku}:`, err.message);
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("Lemon Squeezy Product Setup");
  console.log(`Store ID: ${STORE_ID}`);
  console.log("================================\n");

  const webhookId = await setupWebhook();
  const paygoVariants = await createPayGoProducts();
  const proVariants = await createProProduct();

  console.log("\n================================================");
  console.log("Setup complete!");
  console.log("================================================\n");

  console.log("Copy these to your .env file:\n");

  console.log("# Live PayGo variants");
  for (const [key, id] of Object.entries(paygoVariants)) {
    console.log(`LEMON_SQUEEZY_LIVE_VARIANT_${key}="${id}"`);
  }

  console.log("\n# Live Pro variants");
  for (const [key, id] of Object.entries(proVariants)) {
    console.log(`LEMON_SQUEEZY_LIVE_VARIANT_${key}="${id}"`);
  }

  console.log("\n# For test mode, create a test store in your Lemon Squeezy dashboard,");
  console.log("# then create products there and set:");
  console.log("# LEMON_SQUEEZY_TEST_VARIANT_PAYGO_5=...");
  console.log("# etc.\n");

  if (webhookId) {
    console.log(`Webhook ID: ${webhookId}`);
  }
}

main().catch(console.error);