import { createHash } from "crypto";

/* ------------------------------------------------------------------ */
/* Types                                                             */
/* ------------------------------------------------------------------ */

interface PodcastIndexFeed {
  id: number;
  url: string;
  title: string;
}

interface PodcastIndexEpisode {
  title: string;
  enclosureUrl: string | null;
  guid: string;
  description: string;
  feedUrl: string;
  feedTitle: string;
}

/**
 * Mirrors the RssFeedResult type from route.ts so this module can return
 * the same shape without importing from that file.
 */
export type RssFeedResult =
  | { found: true; feedUrl: string; feedTitle: string; directAudioUrl?: string }
  | { found: false; reason: "empty-results" | "no-match" | "unknown-show" };

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

const PODCAST_INDEX_BASE = "https://api.podcastindex.org/api/1.0";

function getApiKey(): string | undefined {
  return process.env.PODCAST_INDEX_API_KEY;
}

function getApiSecret(): string | undefined {
  return process.env.PODCAST_INDEX_API_SECRET;
}

/* ------------------------------------------------------------------ */
/* Auth helper                                                        */
/* ------------------------------------------------------------------ */

function createAuthHeaders(): Record<string, string> {
  const apiKey = getApiKey()!;
  const apiSecret = getApiSecret()!;
  const epochTime = Math.floor(Date.now() / 1000).toString();
  const hash = createHash("sha1")
    .update(apiKey + apiSecret + epochTime)
    .digest("hex");

  return {
    "X-Auth-Key": apiKey,
    "X-Auth-Date": epochTime,
    Authorization: hash,
    "User-Agent": "SpotifyTranscriptor/1.0",
  };
}

/* ------------------------------------------------------------------ */
/* Text helpers (mirrored from route.ts — small, stable functions)    */
/* ------------------------------------------------------------------ */

function sanitizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOverlapRatio(a: string, b: string): number {
  const wa = a.split(/\s+/).filter(Boolean);
  const wb = b.split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  const common = wa.filter((w) => wb.includes(w)).length;
  return common / Math.max(wa.length, wb.length);
}

function extractEpisodeNumber(title: string): string | null {
  const m = title.match(/(?:#|ep(?:isode)?\.?\s*)(\d+)/i);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Podcast Index API calls                                            */
/* ------------------------------------------------------------------ */

async function searchPodcastIndex(showName: string): Promise<PodcastIndexFeed[]> {
  try {
    const res = await fetch(
      `${PODCAST_INDEX_BASE}/search/byterm?q=${encodeURIComponent(showName)}`,
      { headers: createAuthHeaders() }
    );
    if (!res.ok) {
      console.log(`-> Podcast Index search returned HTTP ${res.status}`);
      return [];
    }
    const data: any = await res.json();
    if (data?.status !== "true" || !Array.isArray(data.feeds)) return [];
    return data.feeds.map((f: any) => ({
      id: f.id ?? 0,
      url: f.url ?? "",
      title: f.title ?? "",
    })).filter((f: PodcastIndexFeed) => f.id > 0 && f.url);
  } catch (err: any) {
    console.log("-> Podcast Index search error:", err?.message ?? err);
    return [];
  }
}

async function fetchPodcastIndexEpisodes(feedId: number): Promise<PodcastIndexEpisode[]> {
  try {
    const res = await fetch(
      `${PODCAST_INDEX_BASE}/episodes/byfeedid?id=${feedId}&max=50`,
      { headers: createAuthHeaders() }
    );
    if (!res.ok) {
      console.log(`-> Podcast Index episodes returned HTTP ${res.status}`);
      return [];
    }
    const data: any = await res.json();
    if (data?.status !== "true" || !Array.isArray(data.items)) return [];
    return data.items.map((item: any) => ({
      title: item.title ?? "",
      enclosureUrl: item.enclosureUrl ?? null,
      guid: item.guid ?? "",
      description: item.description ?? "",
      feedUrl: item.feedUrl ?? "",
      feedTitle: item.feedTitle ?? "",
    }));
  } catch (err: any) {
    console.log("-> Podcast Index episodes error:", err?.message ?? err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Main public function                                                */
/* ------------------------------------------------------------------ */

/**
 * Search for a podcast episode via the Podcast Index API (free, open directory).
 *
 * Returns the same RssFeedResult shape used by findRssFeed in route.ts so the
 * caller can use either source interchangeably.
 *
 * When API keys are not configured, silently returns { found: false }
 * — zero-config fallback, no errors.
 */
export async function findViaPodcastIndex(
  showName: string,
  episodeTitle: string
): Promise<RssFeedResult> {
  // Graceful skip if API keys not configured
  if (!getApiKey() || !getApiSecret()) {
    console.log("-> Podcast Index: API keys not configured, skipping.");
    return { found: false, reason: "no-match" };
  }

  // Step 1: Search for the show by name
  console.log("-> Podcast Index: searching for show:", showName);
  const feeds = await searchPodcastIndex(showName);
  if (feeds.length === 0) {
    console.log("-> Podcast Index: no feeds found for show:", showName);
    return { found: false, reason: "empty-results" };
  }

  const feed = feeds[0];
  console.log(`-> Podcast Index: found feed "${feed.title}" (id=${feed.id})`);

  // Step 2: Fetch recent episodes for this feed
  const episodes = await fetchPodcastIndexEpisodes(feed.id);
  if (episodes.length === 0) {
    console.log("-> Podcast Index: no episodes returned for feed", feed.id);
    return { found: false, reason: "no-match" };
  }

  // Step 3: Match episode by title
  const sanitizedTarget = sanitizeTitle(episodeTitle);
  const targetEpNum = extractEpisodeNumber(episodeTitle);

  // Priority 1: exact title match
  for (const ep of episodes) {
    const sanitizedItem = sanitizeTitle(ep.title);
    if (sanitizedItem === sanitizedTarget || sanitizedItem.includes(sanitizedTarget) || sanitizedTarget.includes(sanitizedItem)) {
      if (ep.enclosureUrl) {
        console.log(`-> Podcast Index: exact title match: "${ep.title}"`);
        return {
          found: true,
          feedUrl: ep.feedUrl || feed.url,
          feedTitle: feed.title,
          directAudioUrl: ep.enclosureUrl,
        };
      }
    }
  }

  // Priority 2: episode number match
  if (targetEpNum) {
    for (const ep of episodes) {
      const itemEpNum = extractEpisodeNumber(ep.title);
      if (itemEpNum && itemEpNum === targetEpNum) {
        if (ep.enclosureUrl) {
          console.log(`-> Podcast Index: episode number match: #${targetEpNum}`);
          return {
            found: true,
            feedUrl: ep.feedUrl || feed.url,
            feedTitle: feed.title,
            directAudioUrl: ep.enclosureUrl,
          };
        }
      }
    }
  }

  // Priority 3: best word-overlap match (min 0.70)
  let best: { ep: PodcastIndexEpisode; score: number } | null = null;
  for (const ep of episodes) {
    const sanitizedItem = sanitizeTitle(ep.title);
    const score = wordOverlapRatio(sanitizedTarget, sanitizedItem);
    if (score > 0 && (!best || score > best.score)) {
      best = { ep, score };
    }
  }

  if (best && best.score >= 0.70 && best.ep.enclosureUrl) {
    console.log(`-> Podcast Index: word-overlap match (${best.score.toFixed(2)}): "${best.ep.title}"`);
    return {
      found: true,
      feedUrl: best.ep.feedUrl || feed.url,
      feedTitle: feed.title,
      directAudioUrl: best.ep.enclosureUrl,
    };
  }

  // No match found
  console.log("-> Podcast Index: no matching episode found for:", episodeTitle);
  return { found: false, reason: "no-match" };
}