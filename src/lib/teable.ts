/* ------------------------------------------------------------------ */
/* Teable database client — cache layer for transcriptions            */
/* ------------------------------------------------------------------ */
/* Table schema:
 *   spotify_episode_id  — Primary text key (22-char Spotify ID)
 *   title               — Text (episode title from oEmbed)
 *   segments            — Long Text (JSON-stringified TranscriptSegment[])
 *   execution_time      — Number (seconds the Whisper pipeline took)
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface CachedEpisodeData {
  title: string;
  segments: TranscriptSegment[];
  executionTime: number;
}

/* ------------------------------------------------------------------ */
/* Configuration — read from environment                              */
/* ------------------------------------------------------------------ */

const TEABLE_BASE_URL: string | undefined = process.env.TEABLE_BASE_URL;
const TEABLE_API_KEY: string | undefined = process.env.TEABLE_API_KEY;
const TEABLE_TABLE_ID: string | undefined = process.env.TEABLE_TABLE_ID;

function isConfigured(): boolean {
  return !!(TEABLE_BASE_URL && TEABLE_API_KEY && TEABLE_TABLE_ID);
}

function requireConfig(): { baseUrl: string; apiKey: string; tableId: string } {
  const baseUrl = TEABLE_BASE_URL;
  const apiKey = TEABLE_API_KEY;
  const tableId = TEABLE_TABLE_ID;
  if (!baseUrl || !apiKey || !tableId) {
    throw new Error(
      "Teable is not fully configured. Set TEABLE_BASE_URL, TEABLE_API_KEY, and TEABLE_TABLE_ID in your environment."
    );
  }
  return { baseUrl, apiKey, tableId };
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Attempt to parse a raw JSON string into a valid TranscriptSegment[].
 * Returns null if the string is empty, unparseable, or doesn't match
 * the expected shape — this is the integrity gate for Rule 3.
 */
function parseSegmentsJson(raw: string): TranscriptSegment[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    for (const seg of parsed) {
      if (
        typeof seg !== "object" ||
        seg === null ||
        typeof (seg as any).start !== "number" ||
        typeof (seg as any).end !== "number" ||
        typeof (seg as any).text !== "string"
      ) {
        return null;
      }
    }
    return parsed as TranscriptSegment[];
  } catch {
    return null;
  }
}

/**
 * Extract a CachedEpisodeData from a raw Teable API record object.
 * Returns null if required fields are missing or segments fail validation.
 */
function recordToCachedData(record: any): CachedEpisodeData | null {
  const fields: Record<string, unknown> = record?.fields ?? {};
  const title: unknown = fields.title;
  const segmentsRaw: unknown = fields.segments;
  const executionTime: unknown = fields.execution_time;

  if (typeof title !== "string" || !title.trim()) return null;
  if (typeof segmentsRaw !== "string" || !segmentsRaw.trim()) return null;

  const segments = parseSegmentsJson(segmentsRaw);
  if (!segments) return null;

  return {
    title: title.trim(),
    segments,
    executionTime: typeof executionTime === "number" ? executionTime : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Query Teable for a cached transcription record by Spotify episode ID.
 *
 * Implements Rule 2 (cache lookup) and Rule 3 (integrity validation).
 * Returns null when:
 *   - Teable is not configured
 *   - No record exists for the given episodeId
 *   - The record's segments column is empty or contains invalid JSON
 *
 * @param episodeId — the 22-character Spotify episode ID (already extracted from URL)
 */
export async function findCachedEpisode(
  episodeId: string
): Promise<CachedEpisodeData | null> {
  if (!isConfigured()) return null;

  const { baseUrl, apiKey, tableId } = requireConfig();

  try {
    const url = new URL(`/api/table/${tableId}/record`, baseUrl);
    url.searchParams.set(
      "filterByTql",
      `("spotify_episode_id" = '${episodeId}')`
    );
    url.searchParams.set("take", "1");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      console.warn(
        `[Teable] Query returned HTTP ${res.status} — treating as cache miss`
      );
      return null;
    }

    const body: any = await res.json();
    const record = body?.records?.[0];
    if (!record) return null;

    return recordToCachedData(record);
  } catch (err: any) {
    console.warn(
      `[Teable] Query failed: ${err?.message ?? err} — treating as cache miss`
    );
    return null;
  }
}

/**
 * Save a completed transcription result to Teable.
 *
 * Implements Rule 6 — called after a successful Whisper pipeline run.
 * Silently no-ops when Teable is not configured.
 *
 * @param params.episodeId   — 22-char Spotify episode ID
 * @param params.title       — Episode title from oEmbed metadata
 * @param params.segments    — Final TranscriptSegment array (will be JSON-stringified)
 * @param params.executionTime — Total Whisper pipeline duration in seconds
 */
export async function saveEpisodeRecord(params: {
  episodeId: string;
  title: string;
  segments: TranscriptSegment[];
  executionTime: number;
}): Promise<void> {
  if (!isConfigured()) return;

  const { baseUrl, apiKey, tableId } = requireConfig();

  const payload = {
    records: [
      {
        fields: {
          spotify_episode_id: params.episodeId,
          title: params.title,
          segments: JSON.stringify(params.segments),
          execution_time: params.executionTime,
        },
      },
    ],
    fieldKeyType: "name",
    typecast: true,
  };

  try {
    const res = await fetch(`${baseUrl}/api/table/${tableId}/record`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      console.warn(
        `[Teable] Failed to save record: HTTP ${res.status} — ${errText}`
      );
    } else {
      console.log(
        `[Teable] Saved transcription for episode ${params.episodeId}`
      );
    }
  } catch (err: any) {
    console.warn(
      `[Teable] Save failed: ${err?.message ?? err} — transcript data is not lost, only uncached`
    );
  }
}