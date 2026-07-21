import fs from "fs";
import path from "path";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface TranscriptionRecord {
  id: string;
  episodeTitle: string;
  showName: string;
  spotifyUrl: string;
  timestamp: string;
  executionTime: number;
  adFiltered: boolean;
}

export interface UserData {
  email: string;
  name: string;
  plan: "free" | "credits" | "pro";
  creditsRemaining: number;
  transcriptions: TranscriptionRecord[];
  apiKeys: ApiKey[];
}

export interface ApiKey {
  key: string;
  label: string;
  created: string;
  lastUsed: string | null;
}

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const FREE_PODS_PER_MONTH = 10;
const DATA_FILE = path.join(process.cwd(), "user-data.json");

/* ------------------------------------------------------------------ */
/* Storage helpers                                                    */
/* ------------------------------------------------------------------ */

function readAllData(): Record<string, UserData> {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {};
}

function writeAllData(data: Record<string, UserData>): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function getUserKey(email: string): string {
  return email.toLowerCase().trim();
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

export function getUserData(email: string): UserData {
  const all = readAllData();
  const key = getUserKey(email);
  if (!all[key]) {
    all[key] = {
      email: email.toLowerCase(),
      name: "",
      plan: "free",
      creditsRemaining: 0,
      transcriptions: [],
      apiKeys: [],
    };
    writeAllData(all);
  }
  return all[key];
}

export function upsertUser(email: string, name: string): UserData {
  const all = readAllData();
  const key = getUserKey(email);
  if (!all[key]) {
    all[key] = {
      email: email.toLowerCase(),
      name,
      plan: "free",
      creditsRemaining: 0,
      transcriptions: [],
      apiKeys: [],
    };
  } else {
    all[key].name = name;
  }
  writeAllData(all);
  return all[key];
}

export function addTranscription(
  email: string,
  record: TranscriptionRecord
): UserData {
  const all = readAllData();
  const key = getUserKey(email);
  if (!all[key]) {
    all[key] = {
      email: email.toLowerCase(),
      name: "",
      plan: "free",
      creditsRemaining: 0,
      transcriptions: [],
      apiKeys: [],
    };
  }
  all[key].transcriptions.unshift(record);
  writeAllData(all);
  return all[key];
}

export function getMonthlyUsage(email: string): number {
  const user = getUserData(email);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return user.transcriptions.filter((t) => t.timestamp >= monthStart).length;
}

export function getUsageStats(email: string): {
  usedThisMonth: number;
  total: number;
  planLimit: number;
  remaining: number;
} {
  const user = getUserData(email);
  const usedThisMonth = getMonthlyUsage(email);
  const planLimit =
    user.plan === "free" ? FREE_PODS_PER_MONTH : user.plan === "pro" ? 999 : Infinity;
  return {
    usedThisMonth,
    total: user.transcriptions.length,
    planLimit,
    remaining: Math.max(0, planLimit - usedThisMonth),
  };
}

export function getTranscriptionHistory(email: string): TranscriptionRecord[] {
  return getUserData(email).transcriptions;
}

/* ------------------------------------------------------------------ */
/* API key management                                                 */
/* ------------------------------------------------------------------ */

function generateApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const random = (len: number) =>
    Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `tk_${random(32)}`;
}

export function createApiKey(email: string, label: string): ApiKey {
  const all = readAllData();
  const key = getUserKey(email);
  if (!all[key]) throw new Error("User not found");
  const apiKey: ApiKey = {
    key: generateApiKey(),
    label,
    created: new Date().toISOString(),
    lastUsed: null,
  };
  all[key].apiKeys.push(apiKey);
  writeAllData(all);
  return apiKey;
}

export function deleteApiKey(email: string, key: string): void {
  const all = readAllData();
  const k = getUserKey(email);
  if (!all[k]) return;
  all[k].apiKeys = all[k].apiKeys.filter((ak) => ak.key !== key);
  writeAllData(all);
}

export function getApiKeys(email: string): ApiKey[] {
  return getUserData(email).apiKeys;
}

export function setUserPlan(
  email: string,
  plan: "free" | "credits" | "pro",
  creditsRemaining?: number
): UserData {
  const all = readAllData();
  const key = getUserKey(email);
  if (!all[key]) throw new Error("User not found");
  all[key].plan = plan;
  if (creditsRemaining !== undefined) {
    all[key].creditsRemaining = creditsRemaining;
  }
  writeAllData(all);
  return all[key];
}