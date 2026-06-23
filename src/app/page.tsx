"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Newsreader, Inter } from "next/font/google";
import { Videotape } from "lucide-react";
import Image from "next/image";
import iphonePic from "@/assets/iphone.png";

// Load the high-contrast editorial serif to match the design aesthetic
const editorialSerif = Newsreader({
  subsets: ["latin"],
  variable: "--font-editorial",
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
});

// Clear geometric sans-serif for interface text, labels, and the long-form transcript
const transcriptSans = Inter({
  subsets: ["latin"],
  variable: "--font-transcript-sans",
});

/* ------------------------------------------------------------------ */
/* Types                                                              */
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
  | { phase: "processing"; message: string; countdown: number | null }
  | { phase: "done" }
  | { phase: "error"; error: string; detail?: string };

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
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
/* Component                                                          */
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
    setStatus({ phase: "processing", message: "Starting...", countdown: null });

    let countdownInterval: ReturnType<typeof setInterval> | null = null;
    let gotResult = false;

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyUrl: trimmed, filterAds }),
      });

      if (!res.body) throw new Error("Response body is empty");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);

            if (parsed.type === "status") {
              setStatus({ phase: "processing", message: parsed.message, countdown: null });
            } else if (parsed.type === "chunks") {
              const count: number = parsed.count;
              const seconds = Math.ceil(count * 0.45) + 5;
              setStatus({
                phase: "processing",
                message: `Estimated transcription ${seconds}s...`,
                countdown: seconds,
              });
              if (countdownInterval) clearInterval(countdownInterval);
              countdownInterval = setInterval(() => {
                setStatus((prev) => {
                  if (prev.phase !== "processing" || prev.countdown === null) return prev;
                  const next = prev.countdown - 1;
                  if (next <= 0) {
                    if (countdownInterval) clearInterval(countdownInterval);
                    return { ...prev, countdown: 0, message: "Estimated transcription 0s..." };
                  }
                  return { ...prev, countdown: next, message: `Estimated transcription ${next}s...` };
                });
              }, 1000);
            } else if (parsed.type === "result") {
              gotResult = true;
              if (countdownInterval) clearInterval(countdownInterval);
              setResult(parsed.data as TranscriptionResult);
              setStatus({ phase: "done" });
            } else if (parsed.type === "error") {
              gotResult = true;
              if (countdownInterval) clearInterval(countdownInterval);
              setStatus({
                phase: "error",
                error: parsed.error,
                detail: parsed.detail,
              });
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      if (!gotResult) {
        if (countdownInterval) clearInterval(countdownInterval);
        setStatus({
          phase: "error",
          error: "Connection closed before transcription completed.",
        });
      }
    } catch (err: any) {
      if (countdownInterval) clearInterval(countdownInterval);
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

  /* -------- Home reset -------- */

  function handleResetHome() {
    setUrl("");
    setResult(null);
    setActiveSegmentIndex(null);
    setStatus({ phase: "idle" });
  }

  /* -------- Derived state -------- */

  const isLoading = status.phase === "processing";

  const statusMessage =
    status.phase === "processing" ? status.message : null;

  return (
    <div className={`${editorialSerif.variable} ${transcriptSans.variable} font-serif min-h-screen bg-[#FDFDFD] text-[#111111] antialiased flex flex-col justify-between`}>

      {/* ---- Header Nav ---- */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-md px-8 py-5 sticky top-0 z-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <button onClick={handleResetHome} className="flex items-center gap-3 cursor-pointer">
            <Videotape className="h-9 w-9 text-black stroke-[1.5]" />
            <span className="font-sans text-2xl font-bold tracking-tight text-black">
              Tranzkript
            </span>
          </button>
          <nav className="font-sans text-sm font-medium text-gray-500 flex items-center gap-8">
            <span className="cursor-not-allowed opacity-40">Features</span>
            <span className="cursor-not-allowed opacity-40">Api</span>
            <span className="cursor-not-allowed opacity-40">Docs</span>
          </nav>
        </div>
      </header>

      {/* ---- Main Layout Context Container ---- */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-12 flex flex-col justify-center">

        {/* ---- Asymmetrical Hero Split: Show only if no result has loaded ---- */}
        {!result && (
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-16 items-center my-auto">

            {/* Left Box: Control Panel & Typography Hooks */}
            <div className="flex flex-col space-y-6">
              <h1 className={`text-4xl md:text-5xl font-bold italic tracking-tight leading-[1.1] text-black ${editorialSerif.className} font-editorial`}>
                Podcast transcription, simplified.
              </h1>

              <p className="font-[family-name:var(--font-barlow-condensed)] text-base leading-relaxed text-gray-500 max-w-xl text-xl">
                Transform any public Spotify podcast episode into a pristine, searchable transcript.
              </p>

              {/* Injected Interactive Form Layout */}
              <div className="pt-2">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <input
                        id="spotify-url"
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="Paste a Spotify episode URL..."
                        className="font-sans w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm text-[#111111] placeholder-gray-400 transition-all focus:border-black focus:outline-none focus:ring-1 focus:ring-black/10 disabled:opacity-50 shadow-[0_2px_8px_rgba(0,0,0,0.01)]"
                        disabled={isLoading}
                        autoFocus
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isLoading || !url.trim()}
                      className="font-sans flex items-center justify-center gap-2 rounded-xl bg-black px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-30 whitespace-nowrap shadow-sm"
                    >
                      {isLoading ? (
                        <>
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                          Processing...
                        </>
                      ) : (
                        "Extract & transcribe"
                      )}
                    </button>
                  </div>

                  {statusMessage && (
                    <div className="font-mono text-xs text-gray-400 flex items-center gap-2 pt-2">
                      <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-black" />
                      {statusMessage}
                    </div>
                  )}

                  {status.phase === "error" && (
                    <div className="font-sans rounded-xl border border-red-100 bg-red-50/40 px-4 py-3.5">
                      <p className="text-xs font-medium text-red-600">{status.error}</p>
                      {status.detail && (
                        <p className="mt-1 text-[11px] text-red-400 leading-normal">{status.detail}</p>
                      )}
                    </div>
                  )}
                </form>
              </div>
            </div>

            {/* Right Column: Visual Preview Card matching Openlane grey pane */}
            {/* Right Column: Visual Preview Pane (Un-framed & Seamless) */}
            <div className="hidden lg:flex items-center justify-end">
              <Image
                src={iphonePic}
                alt="Platform interface preview"
                className="w-full max-w-[420px] h-auto mix-blend-multiply"
                priority
              />
            </div>

          </div>
        )}

        {/* ---- Active Layout Dashboard States & Results ---- */}
        {result && (
          <div className="grid flex-1 gap-8 lg:grid-cols-[340px_1fr] mt-4 animate-in fade-in duration-300">

            {/* Left Box: Fine-lined Editorial Info Module */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
                <span className="font-[family-name:var(--font-barlow-condensed)] text-2xl font-bold text-black">
                  Episode info
                </span>
                <h3 className="font-[family-name:var(--font-barlow-condensed)] text-xl font-bold text-gray-600">
                  {result.metadata.episodeTitle}
                </h3>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-sans mt-2 block truncate text-xs text-gray-400 hover:text-black hover:underline"
                >
                  View on Spotify →
                </a>
              </div>

              {result.segments.length > 0 && (
                <div className="hidden rounded-2xl border border-gray-200 bg-white p-6 lg:block">
                  <span className="font-sans mb-3 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Jump index
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {result.segments.map((seg, i) => (
                      <button
                        key={segmentKey(seg, i)}
                        onClick={() => handleSegmentClick(i)}
                        className={`rounded-lg px-2.5 py-1 font-mono text-xs transition-colors ${activeSegmentIndex === i
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
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)] flex flex-col">
              <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
                <h2 className="font-[family-name:var(--font-barlow-condensed)] text-2xl font-bold text-black">
                  Transcript document
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
                  className="font-sans flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-black hover:text-black"
                >
                  Download TXT ↓
                </button>
              </div>

              {/* Isolated Content Section: Explicitly breaks from serif and adopts geometric font-sans */}
              <div
                ref={transcriptRef}
                className="font-sans max-h-[62vh] space-y-1 overflow-y-auto pr-2"
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
                      className={`flex w-full gap-4 rounded-xl px-3 py-2.5 text-left transition-all ${activeSegmentIndex === i
                        ? "bg-[#FAFABA]/60 border-l-2 border-black"
                        : "hover:bg-gray-50"
                        }`}
                    >
                      <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-gray-400">
                        [{formatTime(seg.start)}]
                      </span>
                      <span className="text-sm leading-relaxed text-[#222222]">
                        {seg.text}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

              </main>

      {/* ---- Footer ---- */}
      <footer className="border-t border-gray-100 bg-white px-8 py-5 text-center font-sans text-[11px] font-medium text-gray-400">
        Not affiliated with Spotify Corporation · <a href="https://github.com/AlexGuri99/spotify-transcriptor" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">Made by Alex Gurinovich</a>
      </footer>
    </div>
  );
}