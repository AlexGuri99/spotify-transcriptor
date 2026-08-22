import { NextRequest } from "next/server";
import { findUserByApiKey, updateApiKeyLastUsed } from "./usage-tracker";
import { parseKeyId, validateKeyFormat } from "./api-keys";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface AuthenticatedUser {
  email: string;
  plan: "free" | "credits" | "pro";
  creditsRemaining: number;
}

export class ApiAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Header extraction                                                  */
/* ------------------------------------------------------------------ */

const BEARER_PREFIX = "Bearer ";

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  if (!auth.startsWith(BEARER_PREFIX)) return null;
  return auth.slice(BEARER_PREFIX.length).trim();
}

/* ------------------------------------------------------------------ */
/* Authentication                                                     */
/* ------------------------------------------------------------------ */

/**
 * Authenticate a v1 API request.
 *
 * Reads the `Authorization: Bearer sk_tzk_...` header, validates the
 * key format, looks up the user in Teable, and returns their info.
 *
 * Throws ApiAuthError on failure — the caller should catch it and return
 * the appropriate HTTP response.
 */
export async function authenticateRequest(
  req: NextRequest
): Promise<AuthenticatedUser> {
  const token = extractBearerToken(req);
  if (!token) {
    throw new ApiAuthError(
      "Missing or invalid Authorization header. Use: Authorization: Bearer sk_tzk_...",
      401
    );
  }

  if (!validateKeyFormat(token)) {
    throw new ApiAuthError(
      "Invalid API key format. Expected: sk_tzk_<keyId><secret>",
      401
    );
  }

  const userData = await findUserByApiKey(token);
  if (!userData) {
    throw new ApiAuthError("API key not found or has been revoked.", 401);
  }

  // Fire-and-forget: update lastUsedAt
  const keyId = parseKeyId(token);
  if (keyId) {
    updateApiKeyLastUsed(userData.email, keyId).catch(() => {});
  }

  return {
    email: userData.email,
    plan: userData.plan,
    creditsRemaining: userData.creditsRemaining,
  };
}