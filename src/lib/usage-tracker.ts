/* ------------------------------------------------------------------ */
/* Teable-based user & transcription storage                           */
/* ------------------------------------------------------------------ */
/* Users table:      email, passwordHash, plan, creditsRemaining, provider */
/* Transcripts table: email, spotify_episode_id, execution_time, episodeTitle, segments */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface TranscriptionRecord {
  id: string;
  episodeTitle: string;
  spotifyUrl: string;
  timestamp: string;
  executionTime: number;
}

export interface UserData {
  email: string;
  passwordHash?: string;
  plan: "free" | "credits" | "pro";
  creditsRemaining: number;
  provider: "credentials" | "google" | "github" | "";
}

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const FREE_PODS_PER_MONTH = 5;

const TEABLE_BASE_URL: string | undefined = process.env.TEABLE_BASE_URL;
const TEABLE_API_KEY: string | undefined = process.env.TEABLE_API_KEY;
const TEABLE_USERS_TABLE_ID: string | undefined = process.env.TEABLE_USERS_TABLE_ID;
const TEABLE_TRANSCRIPTS_TABLE_ID: string | undefined = process.env.TEABLE_TABLE_ID;

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function requireConfig() {
  if (!TEABLE_BASE_URL || !TEABLE_API_KEY) {
    throw new Error("Teable is not configured. Set TEABLE_BASE_URL and TEABLE_API_KEY.");
  }
  return { baseUrl: TEABLE_BASE_URL, apiKey: TEABLE_API_KEY };
}

/* ------------------------------------------------------------------ */
/* Teable API helpers                                                 */
/* ------------------------------------------------------------------ */

async function findRecordByEmail(tableId: string, email: string): Promise<{ id: string; fields: Record<string, unknown> } | null> {
  const { baseUrl, apiKey } = requireConfig();
  const normalizedEmail = email.toLowerCase().trim();

  const filter = JSON.stringify({
    conjunction: "and",
    filterSet: [{ fieldId: "email", operator: "is", value: normalizedEmail }],
  });

  const url = `${baseUrl}/api/table/${tableId}/record?filter=${encodeURIComponent(filter)}&take=1&fieldKeyType=name`;

  console.log("[findRecordByEmail] URL:", url);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  console.log("[findRecordByEmail] Response status:", res.status);
  if (!res.ok) {
    const body = await res.text();
    console.log("[findRecordByEmail] Error body:", body);
    return null;
  }
  const data: any = await res.json();
  console.log("[findRecordByEmail] Records found:", data?.records?.length ?? 0);
  return data?.records?.[0] ?? null;
}

async function createRecord(tableId: string, fields: Record<string, unknown>): Promise<string | null> {
  const { baseUrl, apiKey } = requireConfig();

  const res = await fetch(`${baseUrl}/api/table/${tableId}/record`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      records: [{ fields }],
      fieldKeyType: "name",
      typecast: true,
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) return null;
  const data: any = await res.json();
  return data?.records?.[0]?.id ?? null;
}

async function deleteRecord(tableId: string, recordId: string): Promise<boolean> {
  const { baseUrl, apiKey } = requireConfig();

  const url = `${baseUrl}/api/table/${tableId}/record/${recordId}?fieldKeyType=name`;

  console.log("[deleteRecord] URL:", url);
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8_000),
  });

  console.log("[deleteRecord] Status:", res.status);
  if (!res.ok) {
    const body = await res.text();
    console.log("[deleteRecord] Error body:", body);
  }
  return res.ok;
}

async function updateRecord(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<boolean> {
  const { baseUrl, apiKey } = requireConfig();

  const res = await fetch(`${baseUrl}/api/table/${tableId}/record`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      records: [{ id: recordId, fields }],
      fieldKeyType: "name",
      typecast: true,
    }),
    signal: AbortSignal.timeout(8_000),
  });

  return res.ok;
}

/* ------------------------------------------------------------------ */
/* Public API — Users                                                 */
/* ------------------------------------------------------------------ */

export async function getUserData(email: string): Promise<UserData> {
  const { baseUrl, apiKey } = requireConfig();
  if (!TEABLE_USERS_TABLE_ID) throw new Error("TEABLE_USERS_TABLE_ID not set");

  const record = await findRecordByEmail(TEABLE_USERS_TABLE_ID, email);
  if (record) {
    return {
      email: (record.fields.email as string) ?? email.toLowerCase(),
      passwordHash: (record.fields.passwordHash as string) ?? undefined,
      plan: (record.fields.plan as "free" | "credits" | "pro") ?? "free",
      creditsRemaining: (record.fields.creditsRemaining as number) ?? 0,
      provider: (record.fields.provider as "credentials" | "google" | "github" | "") ?? "",
    };
  }

  // Auto-create user with default values
  const normalizedEmail = email.toLowerCase().trim();
  const fields: Record<string, unknown> = {
    email: normalizedEmail,
    plan: "free",
    creditsRemaining: 0,
    provider: "",
    timestamp: todayISO(),
  };
  await createRecord(TEABLE_USERS_TABLE_ID, fields);

  return {
    email: normalizedEmail,
    plan: "free",
    creditsRemaining: 0,
    provider: "",
  };
}

/** Upsert user on OAuth sign-in (also used for credentials sign-up). */
export async function upsertUser(email: string, provider: "credentials" | "google"): Promise<void> {
  const { baseUrl, apiKey } = requireConfig();
  if (!TEABLE_USERS_TABLE_ID) throw new Error("TEABLE_USERS_TABLE_ID not set");

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await findRecordByEmail(TEABLE_USERS_TABLE_ID, normalizedEmail);

  if (existing) {
    await updateRecord(TEABLE_USERS_TABLE_ID, existing.id, { provider, timestamp: todayISO() });
  } else {
    await createRecord(TEABLE_USERS_TABLE_ID, {
      email: normalizedEmail,
      plan: "free",
      creditsRemaining: 0,
      provider,
      timestamp: todayISO(),
    });
  }
}

export async function setPassword(email: string, passwordHash: string): Promise<void> {
  if (!TEABLE_USERS_TABLE_ID) throw new Error("TEABLE_USERS_TABLE_ID not set");
  const record = await findRecordByEmail(TEABLE_USERS_TABLE_ID, email);
  if (!record) throw new Error("User not found");
  await updateRecord(TEABLE_USERS_TABLE_ID, record.id, { passwordHash });
}

export async function getPasswordHash(email: string): Promise<string | undefined> {
  if (!TEABLE_USERS_TABLE_ID) return undefined;
  const record = await findRecordByEmail(TEABLE_USERS_TABLE_ID, email);
  return (record?.fields?.passwordHash as string) ?? undefined;
}

export async function setUserPlan(
  email: string,
  plan: "free" | "credits" | "pro",
  creditsRemaining?: number
): Promise<UserData> {
  if (!TEABLE_USERS_TABLE_ID) throw new Error("TEABLE_USERS_TABLE_ID not set");
  const record = await findRecordByEmail(TEABLE_USERS_TABLE_ID, email);
  if (!record) throw new Error("User not found");

  const fields: Record<string, unknown> = { plan };
  if (creditsRemaining !== undefined) fields.creditsRemaining = creditsRemaining;
  await updateRecord(TEABLE_USERS_TABLE_ID, record.id, fields);

  return {
    email: email.toLowerCase(),
    plan,
    creditsRemaining: creditsRemaining ?? (record.fields.creditsRemaining as number) ?? 0,
    provider: (record.fields.provider as "" | "credentials" | "google" | "github") ?? "",
  };
}

export async function deleteUser(email: string): Promise<boolean> {
  const { baseUrl, apiKey } = requireConfig();
  if (!TEABLE_USERS_TABLE_ID) throw new Error("TEABLE_USERS_TABLE_ID not set");

  console.log("[deleteUser] Looking up:", email);
  const userRecord = await findRecordByEmail(TEABLE_USERS_TABLE_ID, email);
  if (!userRecord) {
    console.log("[deleteUser] User NOT found in Teable");
    return false;
  }
  console.log("[deleteUser] Found record ID:", userRecord.id);

  // Delete all transcripts for this user
  await deleteTranscriptsForUser(email);

  // Delete the user record
  return deleteRecord(TEABLE_USERS_TABLE_ID, userRecord.id);
}

async function deleteTranscriptsForUser(email: string): Promise<void> {
  const { baseUrl, apiKey } = requireConfig();
  if (!TEABLE_TRANSCRIPTS_TABLE_ID) return;

  const normalizedEmail = email.toLowerCase().trim();

  const filter = JSON.stringify({
    conjunction: "and",
    filterSet: [{ fieldId: "email", operator: "is", value: normalizedEmail }],
  });

  const url = `${baseUrl}/api/table/${TEABLE_TRANSCRIPTS_TABLE_ID}/record?filter=${encodeURIComponent(filter)}&fieldKeyType=name`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) return;
  const data: any = await res.json();
  if (!data?.records?.length) return;

  const recordIds = data.records.map((r: any) => r.id);

  // Delete individually using path-based approach
  for (const id of recordIds) {
    const deleteUrl = `${baseUrl}/api/table/${TEABLE_TRANSCRIPTS_TABLE_ID}/record/${id}?fieldKeyType=name`;
    await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Public API — Transcripts                                           */
/* ------------------------------------------------------------------ */

export async function addTranscription(
  email: string,
  record: TranscriptionRecord
): Promise<void> {
  if (!TEABLE_TRANSCRIPTS_TABLE_ID) return;

  const { baseUrl, apiKey } = requireConfig();

  // Extract episode ID from the spotify URL
  const episodeIdMatch = record.id || record.spotifyUrl.match(/\/episode\/([a-zA-Z0-9]{22})/);
  const episodeId = typeof episodeIdMatch === "string" ? episodeIdMatch : episodeIdMatch?.[1] ?? "";

  await fetch(`${baseUrl}/api/table/${TEABLE_TRANSCRIPTS_TABLE_ID}/record`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      records: [{
        fields: {
          email: email.toLowerCase().trim(),
          spotify_episode_id: episodeId,
          execution_time: record.executionTime,
          episodeTitle: record.episodeTitle,
          timestamp: record.timestamp,
          segments: "[]",
        },
      }],
      fieldKeyType: "name",
      typecast: true,
    }),
    signal: AbortSignal.timeout(8_000),
  });
}

export async function getMonthlyUsage(email: string): Promise<number> {
  if (!TEABLE_TRANSCRIPTS_TABLE_ID) return 0;
  const records = await getTranscriptRecords(email);
  if (!records.length) return 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  return records.filter((r) => new Date(r.timestamp).getTime() >= monthStart).length;
}

export async function getUsageStats(email: string): Promise<{
  usedThisMonth: number;
  total: number;
  planLimit: number;
  remaining: number;
  creditsRemaining: number;
}> {
  const user = await getUserData(email);
  const records = await getTranscriptRecords(email);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const usedThisMonth = records.filter((r) => new Date(r.timestamp).getTime() >= monthStart).length;
  const total = records.length;

  // Plan limits:
  // - free: 5 per month
  // - pro: creditsRemaining stores the pod count (e.g., 30 pods)
  // - credits: no monthly limit, uses credits balance
  let planLimit: number;
  let remaining: number;

  if (user.plan === "free") {
    planLimit = FREE_PODS_PER_MONTH;
    remaining = Math.max(0, planLimit - usedThisMonth);
  } else if (user.plan === "pro") {
    planLimit = user.creditsRemaining > 0 ? user.creditsRemaining : 999;
    remaining = Math.max(0, planLimit - usedThisMonth);
  } else {
    // "credits" plan — no monthly limit, but uses credit balance
    planLimit = Infinity;
    remaining = Infinity;
  }

  return {
    usedThisMonth,
    total,
    planLimit,
    remaining,
    creditsRemaining: user.creditsRemaining,
  };
}

/** Deduct one credit from a PayGo user. Returns false if insufficient credits. */
export async function deductCredit(email: string): Promise<boolean> {
  const user = await getUserData(email);
  if (user.plan !== "credits") return true; // Non-credits users don't need credit deduction
  if (user.creditsRemaining <= 0) return false;
  await setUserPlan(email, "credits", user.creditsRemaining - 1);
  return true;
}

export async function getTranscriptionHistory(email: string): Promise<TranscriptionRecord[]> {
  return getTranscriptRecords(email);
}

async function getTranscriptRecords(email: string): Promise<TranscriptionRecord[]> {
  const { baseUrl, apiKey } = requireConfig();
  if (!TEABLE_TRANSCRIPTS_TABLE_ID) return [];

  const normalizedEmail = email.toLowerCase().trim();

  const filter = JSON.stringify({
    conjunction: "and",
    filterSet: [{ fieldId: "email", operator: "is", value: normalizedEmail }],
  });

  const url = `${baseUrl}/api/table/${TEABLE_TRANSCRIPTS_TABLE_ID}/record?filter=${encodeURIComponent(filter)}&fieldKeyType=name`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) return [];
  const data: any = await res.json();
  if (!data?.records) return [];

  return data.records.map((r: any) => ({
    id: r.fields.spotify_episode_id ?? "",
    episodeTitle: r.fields.episodeTitle ?? "",
    spotifyUrl: `https://open.spotify.com/episode/${r.fields.spotify_episode_id}`,
    timestamp: r.fields.timestamp ?? r.createdTime ?? new Date().toISOString(),
    executionTime: r.fields.execution_time ?? 0,
  }));
}