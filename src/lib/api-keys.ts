import { createHash, randomBytes } from "crypto";

/* ------------------------------------------------------------------ */
/* Types                                                             */
/* ------------------------------------------------------------------ */

export interface ApiKeyEntry {
  keyId: string;
  keyHash: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Constants                                                         */
/* ------------------------------------------------------------------ */

const KEY_PREFIX = "sk_tzk_";

/** Full key format: sk_tzk_<keyId (16 hex)><secret (40 hex)> */
const KEY_ID_HEX_LEN = 16;
const SECRET_HEX_LEN = 40;
const FULL_KEY_LEN = KEY_PREFIX.length + KEY_ID_HEX_LEN + SECRET_HEX_LEN;

/* ------------------------------------------------------------------ */
/* Hash                                                              */
/* ------------------------------------------------------------------ */

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

/* ------------------------------------------------------------------ */
/* Key generation                                                     */
/* ------------------------------------------------------------------ */

export function generateApiKey(name: string): {
  plaintext: string;
  entry: ApiKeyEntry;
} {
  const keyId = randomBytes(8).toString("hex");
  const secret = randomBytes(20).toString("hex");
  const fullKey = `${KEY_PREFIX}${keyId}${secret}`;

  return {
    plaintext: fullKey,
    entry: {
      keyId,
      keyHash: hashApiKey(fullKey),
      name,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Parsing & validation                                              */
/* ------------------------------------------------------------------ */

export function parseKeyId(fullKey: string): string | null {
  if (!fullKey.startsWith(KEY_PREFIX)) return null;
  const body = fullKey.slice(KEY_PREFIX.length);
  if (body.length < KEY_ID_HEX_LEN) return null;
  const keyId = body.slice(0, KEY_ID_HEX_LEN);
  if (!/^[a-f0-9]+$/.test(keyId)) return null;
  return keyId;
}

export function validateKeyFormat(fullKey: string): boolean {
  if (!fullKey.startsWith(KEY_PREFIX)) return false;
  if (fullKey.length !== FULL_KEY_LEN) return false;
  const body = fullKey.slice(KEY_PREFIX.length);
  return /^[a-f0-9]+$/.test(body);
}

/** Return a masked display string: sk_tzk_a1b2c3d4...e5f6 */
export function maskKey(fullKey: string): string {
  const keyId = parseKeyId(fullKey);
  if (!keyId) return "invalid";
  const tail = fullKey.slice(-4);
  return `${KEY_PREFIX}${keyId}...${tail}`;
}