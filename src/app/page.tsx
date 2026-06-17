"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface Metadata {
  episodeTitle: string;
  showName: string;
}

interface TranscriptionResult {
  metadata: Metadata;
  rssFeedUrl: string | null;
  transcript: string;
  segments: TranscriptSegment[];
  adFiltered: boolean;
}

type Status =
  | { phase: "idle" }
  | { phase: "scraping"; message: string }
  | { phase: "resolving-rss"; message: string }
  | { phase: "downloading"; message: string }
  | { phase: "transcribing"; message: string }
  | { phase: "filtering"; message: string }
  | { phase: "done" }
  | { phase: "error"; error: string; detail?: string };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function segmentKey(seg: TranscriptSegment, i: number): string {
  return `${seg.start}-${seg.end}-${i}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [filterAds, setFilterAds] = useState(false);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(
    null
  );

  const transcriptRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<number | null>(null);

  /* Clean up polling on unmount */
  useEffect(() => {
    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  /* -------- Form submission -------- */

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmed = url.trim();
    if (!trimmed) return;

    setResult(null);
    setActiveSegmentIndex(null);
    // Reset and begin the progress chain.
    setStatus({ phase: "scraping", message: "Fetching episode metadata from Spotify …" });

    try {
      // Add a small delay so the user sees each progress step.
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyUrl: trimmed, filterAds }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({
          phase: "error",
          error: data.error ?? "Request failed",
          detail: data.detail,
        });
        return;
      }

      setResult(data as TranscriptionResult);
      setStatus({ phase: "done" });
    } catch (err: any) {
      setStatus({
        phase: "error",
        error: err?.message ?? "Network error — is the server running?",
      });
    }
  }

  /* -------- Segment click (seek) -------- */

  function handleSegmentClick(index: number) {
    setActiveSegmentIndex(index);
    const seg = result?.segments[index];
    if (seg && transcriptRef.current) {
      const el = transcriptRef.current.children[index] as HTMLElement | undefined;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /* -------- Derived state -------- */

  const isLoading =
    status.phase === "scraping" ||
    status.phase === "resolving-rss" ||
    status.phase === "downloading" ||
    status.phase === "transcribing" ||
    status.phase === "filtering";

  const statusMessage =
    status.phase === "scraping" || status.phase === "resolving-rss" ||
    status.phase === "downloading" || status.phase === "transcribing" ||
    status.phase === "filtering"
      ? status.message
      : null;

  /* -------- Render -------- */

  return (
    <div className="min-h-screen flex flex-col">
      {/* ---- Header ---- */}
      <header className="border-b border-gray-800 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 text-sm font-bold text-white shadow-lg shadow-cyan-500/20">
            ST
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Spotify Transcriptor
            </h1>
            <p className="text-xs text-gray-500">
              Podcast transcription powered by OpenRouter AI
            </p>
          </div>
        </div>
      </header>

      {/* ---- Main ---- */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8">
        {/* ---- Input form ---- */}
        <form
          onSubmit={handleSubmit}
          className="mb-8 rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            {/* URL field */}
            <div className="flex-1">
              <label
                htmlFor="spotify-url"
                className="mb-1.5 block text-xs font-medium text-gray-400 uppercase tracking-wide"
              >
                Spotify Episode URL
              </label>
              <input
                id="spotify-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://open.spotify.com/episode/..."
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-600 transition-colors focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 disabled:opacity-40"
                disabled={isLoading}
                autoFocus
              />
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading || !url.trim()}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-600/20 transition-all hover:from-cyan-500 hover:to-emerald-500 hover:shadow-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoading ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin-slow rounded-full border-2 border-white/30 border-t-white" />
                  Processing …
                </>
              ) : (
                <>
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"
                    />
                  </svg>
                  Extract &amp; Transcribe
                </>
              )}
            </button>
          </div>

          {/* Ad-filter toggle */}
          <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-gray-400">
            <div className="relative">
              <input
                type="checkbox"
                checked={filterAds}
                onChange={(e) => setFilterAds(e.target.checked)}
                disabled={isLoading}
                className="peer sr-only"
              />
              <div className="h-5 w-9 rounded-full bg-gray-700 transition-colors peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-500/50" />
              <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-gray-300 transition-all peer-checked:translate-x-4 peer-checked:bg-white" />
            </div>
            <span>
              Enable AI Ad-Insertion Filter{" "}
              <span className="text-gray-600">(Strip Sponsor Reads)</span>
            </span>
          </label>

          {/* Progress indicator */}
          {statusMessage && (
            <div className="mt-3 flex items-center gap-2 text-xs text-cyan-400">
              <span className="inline-block h-2 w-2 animate-pulse-ring rounded-full bg-cyan-400" />
              {statusMessage}
            </div>
          )}

          {/* Error */}
          {status.phase === "error" && (
            <div className="mt-4 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3">
              <p className="text-sm font-medium text-red-400">{status.error}</p>
              {status.detail && (
                <p className="mt-1 text-xs text-red-500/80">{status.detail}</p>
              )}
            </div>
          )}
        </form>

        {/* ---- Results ---- */}
        {result && (
          <div className="grid flex-1 gap-6 lg:grid-cols-[360px_1fr]">
            {/* Left – Metadata card */}
            <div>
              <div className="sticky top-8 space-y-4">
                <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
                  <h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
                    Episode Info
                  </h2>
                  <h3 className="mt-2 text-base font-semibold leading-snug text-white">
                    {result.metadata.episodeTitle}
                  </h3>
                  <p className="mt-1 text-sm text-gray-400">
                    {result.metadata.showName}
                  </p>

                  {result.rssFeedUrl && (
                    <div className="mt-4 border-t border-gray-800 pt-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        RSS Source
                      </p>
                      <a
                        href={result.rssFeedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block truncate text-xs text-cyan-400 underline-offset-2 hover:underline"
                      >
                        {result.rssFeedUrl}
                      </a>
                    </div>
                  )}

                  <div className="mt-4 border-t border-gray-800 pt-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                      Transcript Stats
                    </p>
                    <ul className="mt-1.5 space-y-1 text-sm text-gray-400">
                      <li>
                        Segments:{" "}
                        <span className="text-gray-200">
                          {result.segments.length}
                        </span>
                      </li>
                      <li>
                        Duration:{" "}
                        <span className="text-gray-200">
                          {result.segments.length > 0
                            ? formatTime(
                                result.segments[result.segments.length - 1].end
                              )
                            : "—"}
                        </span>
                      </li>
                      {result.adFiltered && (
                        <li className="flex items-center gap-1.5 text-emerald-400">
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                          Ads filtered
                        </li>
                      )}
                    </ul>
                  </div>
                </div>

                {result.segments.length > 0 && (
                  <div className="hidden rounded-xl border border-gray-800 bg-gray-900/60 p-5 lg:block">
                    <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                      Jump to Segment
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                      {result.segments.map((seg, i) => (
                        <button
                          key={segmentKey(seg, i)}
                          onClick={() => handleSegmentClick(i)}
                          className={`rounded px-2 py-0.5 text-xs transition-colors ${
                            activeSegmentIndex === i
                              ? "bg-cyan-600 text-white"
                              : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                          }`}
                        >
                          {formatTime(seg.start)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right – Transcript */}
            <div className="min-h-0">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500">
                  Transcript
                </h2>
                <button
                  onClick={() => {
                    const blob = new Blob([result.transcript], {
                      type: "text/plain",
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${result.metadata.episodeTitle.replace(
                      /[^a-zA-Z0-9 ]/g,
                      ""
                    )}.txt`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                  Download TXT
                </button>
              </div>

              <div
                ref={transcriptRef}
                className="max-h-[65vh] space-y-0.5 overflow-y-auto rounded-xl border border-gray-800 bg-gray-900/40 p-4 custom-scrollbar"
              >
                {result.segments.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {result.transcript}
                  </p>
                ) : (
                  result.segments.map((seg, i) => (
                    <button
                      key={segmentKey(seg, i)}
                      onClick={() => handleSegmentClick(i)}
                      className={`flex w-full gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        activeSegmentIndex === i
                          ? "bg-cyan-600/15 text-cyan-300"
                          : "text-gray-300 hover:bg-gray-800/60 hover:text-gray-100"
                      }`}
                    >
                      <span
                        className={`mt-0.5 shrink-0 font-mono text-xs leading-5 ${
                          activeSegmentIndex === i
                            ? "text-cyan-400"
                            : "text-gray-600"
                        }`}
                      >
                        {formatTime(seg.start)}
                      </span>
                      <span className="leading-5">{seg.text}</span>
                    </button>
                  ))
                )}
              </div>

              {result.adFiltered && (
                <p className="mt-2 text-xs text-gray-600">
                  Ad-filtering was applied — sponsor segments have been removed
                  from the transcript above.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ---- Empty state ---- */}
        {!result && status.phase === "idle" && (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/10 to-emerald-500/10 ring-1 ring-gray-800">
                <svg
                  className="h-7 w-7 text-cyan-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-300">
                Paste a Spotify podcast link to begin
              </h2>
              <p className="mt-1.5 text-sm text-gray-600">
                The app will scrape the public metadata, resolve the RSS feed,
                download the audio, and transcribe it via OpenRouter AI.
              </p>
            </div>
          </div>
        )}

        {/* ---- Loading skeleton (during API call) ---- */}
        {isLoading && !result && (
          <div className="grid flex-1 gap-6 lg:grid-cols-[360px_1fr]">
            <div className="space-y-4">
              <div className="animate-pulse rounded-xl border border-gray-800 bg-gray-900/60 p-5">
                <div className="mb-4 h-3 w-20 rounded bg-gray-800" />
                <div className="mb-2 h-5 w-3/4 rounded bg-gray-800" />
                <div className="mb-4 h-4 w-1/2 rounded bg-gray-800" />
                <div className="h-10 w-full rounded bg-gray-800" />
              </div>
            </div>
            <div className="animate-pulse rounded-xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="mb-4 h-3 w-24 rounded bg-gray-800" />
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-4 rounded bg-gray-800"
                    style={{ width: `${60 + Math.random() * 40}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ---- Footer ---- */}
      <footer className="border-t border-gray-800 px-6 py-4 text-center text-xs text-gray-600">
        Powered by OpenRouter AI &middot; Not affiliated with Spotify
      </footer>
    </div>
  );
}