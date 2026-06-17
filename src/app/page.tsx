"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Playfair_Display, Inter } from "next/font/google";
import { Videotape } from "lucide-react";

// Initialize built-in next fonts to exactly mimic the layout typography
const serifFont = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "600", "700"],
});

const sansFont = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

/* ------------------------------------------------------------------ */
/* Types                                                             */
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
/* Helpers                                                           */
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
/* Component                                                         */
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
    setStatus({ phase: "scraping", message: "Fetching episode metadata from Spotify …" });

    try {
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

  return (
    <div className={`font-editorial min-h-screen bg-[#FDFDFD] text-[#111111] antialiased`}>
      
      {/* ---- Header ---- */}
      <header className="border-b border-gray-200 bg-white px-8 py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Swapped brand text for a big, stylized Lucide Videotape Icon layout */}
            <div className="flex items-center gap-2.5">
              <Videotape className="h-8 w-8 text-black stroke-[1.25]" />
              <span className="text-sm font-semibold tracking-wider uppercase text-gray-400">
                Tranzkript
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ---- Main Layout ---- */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-8 py-10">
        
        {/* ---- Fine-lined Input Container ---- */}
        <div className="mb-12 rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="flex-1">
                <label
                  htmlFor="spotify-url"
                  className="mb-2 block text-[11px] font-semibold text-gray-400 uppercase tracking-widest"
                >
                  Spotify Episode URL
                </label>
                <input
                  id="spotify-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste URL here..."
                  className="w-full rounded-xl border border-gray-200 bg-[#F9F9F9] px-4 py-3 text-sm text-[#111111] placeholder-gray-400 transition-all focus:border-black focus:bg-white focus:outline-none focus:ring-1 focus:ring-black/20 disabled:opacity-40"
                  disabled={isLoading}
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || !url.trim()}
                className="flex items-center justify-center gap-2 rounded-xl bg-black px-6 py-3 text-sm font-medium text-white transition-all hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {isLoading ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                    Processing...
                  </>
                ) : (
                  "Extract & Transcribe"
                )}
              </button>
            </div>

            {/* Premium toggle matching image styling parameters */}
            <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
              <label className="flex cursor-pointer items-center gap-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={filterAds}
                    onChange={(e) => setFilterAds(e.target.checked)}
                    disabled={isLoading}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-9 rounded-full bg-gray-200 transition-colors peer-checked:bg-black" />
                  <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all peer-checked:translate-x-4" />
                </div>
                <span>Enable AI Ad-Insertion Filter</span>
              </label>

              {statusMessage && (
                <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
                  <span className="inline-block h-2 w-2 animate-ping rounded-full bg-black" />
                  {statusMessage}
                </div>
              )}
            </div>

            {status.phase === "error" && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50/50 px-4 py-3">
                <p className="text-xs font-medium text-red-600">{status.error}</p>
                {status.detail && (
                  <p className="mt-1 text-[11px] text-red-400">{status.detail}</p>
                )}
              </div>
            )}
          </form>
        </div>

        {/* ---- Layout States & Results ---- */}
        {result ? (
          <div className="grid flex-1 gap-8 lg:grid-cols-[340px_1fr]">
            
            {/* Left Box: Fine-lined Editorial Info Module */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Episode Info
                </span>
                <h3 className="mt-3 text-xl font-bold leading-tight text-black">
                  {result.metadata.episodeTitle}
                </h3>
                <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                  ~ {result.metadata.showName}
                </p>

                {result.rssFeedUrl && (
                  <div className="mt-6 border-t border-gray-100 pt-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      RSS Source
                    </span>
                    <a
                      href={result.rssFeedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block truncate font-mono text-xs text-gray-500 hover:text-black hover:underline"
                    >
                      {result.rssFeedUrl}
                    </a>
                  </div>
                )}

                {/* Geometric Stats Blocks similar to My Growth component */}
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <span className="mb-3 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Stats Analysis
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-gray-100 bg-[#FAFABA] p-3 text-center">
                      <span className="text-[10px] font-mono font-bold text-gray-500">(*)</span>
                      <p className="text-xl font-bold mt-1">
                        {result.segments.length}
                      </p>
                      <span className="text-[9px] uppercase tracking-wider text-gray-400 block mt-0.5">
                        Segments
                      </span>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-[#F4F4F4] p-3 text-center">
                      <span className="text-[10px] font-mono font-bold text-gray-500">(#)</span>
                      <p className="text-xl font-bold mt-1">
                        {result.segments.length > 0
                          ? formatTime(result.segments[result.segments.length - 1].end)
                          : "—"}
                      </p>
                      <span className="text-[9px] uppercase tracking-wider text-gray-400 block mt-0.5">
                        Duration
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {result.segments.length > 0 && (
                <div className="hidden rounded-2xl border border-gray-200 bg-white p-6 lg:block">
                  <span className="mb-3 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Jump Index
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {result.segments.map((seg, i) => (
                      <button
                        key={segmentKey(seg, i)}
                        onClick={() => handleSegmentClick(i)}
                        className={`rounded-lg px-2.5 py-1 font-mono text-xs transition-colors ${
                          activeSegmentIndex === i
                            ? "bg-black text-white"
                            : "bg-[#F5F5F5] text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {formatTime(seg.start)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Box: Pristine Transcript Output Sheet */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] flex flex-col">
              <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
                <h2 className="text-lg font-bold text-black">
                  Transcript Document
                </h2>
                <button
                  onClick={() => {
                    const blob = new Blob([result.transcript], { type: "text/plain" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${result.metadata.episodeTitle.replace(/[^a-zA-Z0-9 ]/g, "")}.txt`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-black hover:text-black"
                >
                  Download TXT ↓
                </button>
              </div>

              <div
                ref={transcriptRef}
                className="max-h-[62vh] space-y-1 overflow-y-auto pr-2"
              >
                {result.segments.length === 0 ? (
                  <p className="text-base leading-relaxed text-gray-800 p-2">
                    {result.transcript}
                  </p>
                ) : (
                  result.segments.map((seg, i) => (
                    <button
                      key={segmentKey(seg, i)}
                      onClick={() => handleSegmentClick(i)}
                      className={`flex w-full gap-4 rounded-xl px-3 py-2.5 text-left transition-all ${
                        activeSegmentIndex === i
                          ? "bg-[#FAFABA]/60 border-l-2 border-black"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-gray-400">
                        [{formatTime(seg.start)}]
                      </span>
                      <span className="text-base leading-relaxed text-[#222222]">
                        {seg.text}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Empty or Loading Sandbox */
          !isLoading && (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
                            <h2 className="text-2xl font-bold text-black">
                Pristine Audio Transcription Pipeline
              </h2>
              <p className="mt-2 max-w-md text-sm text-gray-400">
                Paste an active public Spotify link inside the directory node to split, 
                serialize, and map text transcripts onto your workspace container framework.
              </p>
            </div>
          )
        )}

        {/* Loading Shell matching layout grid boundaries */}
        {isLoading && !result && (
          <div className="grid flex-1 gap-8 lg:grid-cols-[340px_1fr]">
            <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-6">
              <div className="mb-4 h-3 w-16 rounded bg-gray-100" />
              <div className="mb-2 h-6 w-3/4 rounded bg-gray-100" />
              <div className="h-4 w-1/2 rounded bg-gray-100" />
            </div>
            <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-6">
              <div className="mb-4 h-4 w-32 rounded bg-gray-100" />
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-4 rounded bg-gray-100" style={{ width: `${70 + Math.random() * 25}%` }} />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ---- Footer ---- */}
      <footer className="border-t border-gray-100 bg-white px-8 py-5 text-center text-[11px] font-medium uppercase tracking-widest text-gray-400">
        Not affiliated with Spotify Corporation · <a href="https://github.com/AlexGuri99/spotify-transcriptor" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">Made by Alex Gurinovich</a>
      </footer>
    </div>
  );
}