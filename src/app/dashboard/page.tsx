"use client";

import { useState, useEffect, useCallback, useRef, FormEvent } from "react";
import { useSession, signOut } from "next-auth/react";
import { redirect } from "next/navigation";
import { Newsreader, Inter } from "next/font/google";
import Link from "next/link";
import SiteFooter from "@/components/site-footer";
import { getProTier } from "@/lib/lemon-squeezy";
import {
  Videotape,
  LogOut,
  BarChart3,
  History,
  CreditCard,
  ExternalLink,
  Clock,
  Zap,
  FileText,
  Sparkles,
  Eye,
  X,
} from "lucide-react";

const editorialSerif = Newsreader({
  subsets: ["latin"],
  variable: "--font-editorial",
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
});

const transcriptSans = Inter({
  subsets: ["latin"],
  variable: "--font-transcript-sans",
});

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

interface TranscriptionRecord {
  id: string;
  episodeTitle: string;
  spotifyUrl: string;
  timestamp: string;
  executionTime: number;
  thumbnailUrl?: string;
}

interface CachedEpisodeData {
  title: string;
  segments: TranscriptSegment[];
  executionTime: number;
}

interface UsageStats {
  usedThisMonth: number;
  total: number;
  planLimit: number;
  remaining: number;
  plan: string;
  creditsRemaining: number;
}


/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/* Tabs                                                               */
/* ------------------------------------------------------------------ */

type Tab = "workspace" | "settings";

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "workspace", label: "Workspace", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: CreditCard },
];

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { data: session } = useSession();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <DashboardShell session={session} />
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard Shell                                                    */
/* ------------------------------------------------------------------ */

function DashboardShell({ session }: { session: any }) {
  const [activeTab, setActiveTab] = useState<Tab>("workspace");

  return (
    <div className={`${editorialSerif.variable} ${transcriptSans.variable} font-serif min-h-screen bg-[#FDFDFD] text-[#111111] antialiased flex flex-col`}>
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-md px-8 py-5 sticky top-0 z-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Videotape className="h-9 w-9 text-black stroke-[1.5]" />
            <span className="font-sans text-2xl font-bold tracking-tight text-black">
              Tranzkript
            </span>
          </Link>
          <nav className="font-sans text-sm font-medium text-gray-500 flex items-center gap-8">
            <button onClick={() => signOut()} className="flex items-center gap-1.5 text-white bg-black rounded-full px-4 py-1.5 hover:bg-gray-900 transition-colors cursor-pointer border-none">
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-12">
        {/* Welcome header */}
        <div className="mb-8">
          <h1 className={`text-3xl md:text-4xl font-bold italic tracking-tight leading-[1.1] text-black ${editorialSerif.className}`}>
            Dashboard
          </h1>
          <p className="font-sans text-base text-gray-500 mt-2">
            Welcome back, {session.user.email?.split("@")[0]}
          </p>
        </div>

        {/* Tab navigation */}
        <div className="border-b border-gray-100 mb-8">
          <div className="flex gap-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`font-sans flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
                    activeTab === tab.id
                      ? "border-black text-black"
                      : "border-transparent text-gray-400 hover:text-gray-600"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "workspace" && <WorkspaceTab email={session.user.email!} />}
        {activeTab === "settings" && <SettingsTab email={session.user.email!} />}
              </main>

      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Types for transcription form                                       */
/* ------------------------------------------------------------------ */

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface Metadata {
  episodeTitle: string;
}

interface TranscriptionResult {
  metadata: Metadata;
  rssFeedUrl: string | null;
  transcript: string;
  segments: TranscriptSegment[];
  executionTime?: number;
}

type Status =
  | { phase: "idle" }
  | { phase: "processing"; message: string; countdown: number | null }
  | { phase: "done" }
  | { phase: "error"; error: string; detail?: string };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function segmentKey(seg: TranscriptSegment, i: number): string {
  return `${seg.start}-${seg.end}-${i}`;
}

/* ------------------------------------------------------------------ */
/* Workspace Tab                                                      */
/* ------------------------------------------------------------------ */

function WorkspaceTab({ email: _email }: { email: string }) {
  const [url, setUrl] = useState("");
  const [filterAds, setFilterAds] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingEpisode, setViewingEpisode] = useState<string | null>(null);
  const [viewingTranscript, setViewingTranscript] = useState<CachedEpisodeData | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);
  const [showViewerTimestamps, setShowViewerTimestamps] = useState(true);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const transcriptRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((r) => r.json()),
      fetch("/api/dashboard/history").then((r) => r.json()),
    ])
      .then(([statsData, historyData]) => {
        setStats(statsData);
        const items = historyData.history || [];
        setHistory(items);
        setLoading(false);
        /* Fetch thumbnails for all history items */
        items.forEach((item: TranscriptionRecord) => {
          fetchThumbnail(item.id, item.spotifyUrl);
        });
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  /* -------- Open transcript viewer -------- */
  async function openTranscript(episodeId: string) {
    setViewingEpisode(episodeId);
    setViewingTranscript(null);
    setViewingLoading(true);
    try {
      const res = await fetch(`/api/transcript/${episodeId}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setViewingTranscript(data);
    } catch {
      setViewingTranscript(null);
    } finally {
      setViewingLoading(false);
    }
  }

  /* -------- Fetch thumbnail for a history item -------- */
  async function fetchThumbnail(episodeId: string, spotifyUrl: string) {
    if (thumbnails[episodeId]) return;
    try {
      const res = await fetch(`/api/oembed?url=${encodeURIComponent(spotifyUrl)}`);
      const data = await res.json();
      if (data.thumbnailUrl) {
        setThumbnails((prev) => ({ ...prev, [episodeId]: data.thumbnailUrl }));
      }
    } catch {}
  }

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
        body: JSON.stringify({ sourceMode: "spotify", url: trimmed, filterAds }),
      });

      if (!res.ok) {
        let errorMsg = `Server error (HTTP ${res.status})`;
        let errorDetail: string | undefined;
        try {
          const errBody = await res.json();
          if (errBody.error) errorMsg = errBody.error;
          if (errBody.detail) errorDetail = errBody.detail;
        } catch {}
        if (countdownInterval) clearInterval(countdownInterval);
        setStatus({ phase: "error", error: errorMsg, detail: errorDetail });
        return;
      }

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
              setStatus({ phase: "processing", message: `Estimated transcription ${seconds}s...`, countdown: seconds });
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
              // Refresh stats & history
              Promise.all([
                fetch("/api/dashboard/stats").then((r) => r.json()),
                fetch("/api/dashboard/history").then((r) => r.json()),
              ]).then(([s, h]) => {
                setStats(s);
                const items = h.history || [];
                setHistory(items);
                items.forEach((item: TranscriptionRecord) => {
                  fetchThumbnail(item.id, item.spotifyUrl);
                });
              });
            } else if (parsed.type === "error") {
              gotResult = true;
              if (countdownInterval) clearInterval(countdownInterval);
              setStatus({ phase: "error", error: parsed.error, detail: parsed.detail });
            }
          } catch {}
        }
      }
      if (!gotResult) {
        if (countdownInterval) clearInterval(countdownInterval);
        setStatus({ phase: "error", error: "Connection closed before transcription completed." });
      }
    } catch (err: any) {
      if (countdownInterval) clearInterval(countdownInterval);
      setStatus({ phase: "error", error: err?.message ?? "Network error — is the server running?" });
    }
  }

  function handleSegmentClick(index: number) {
    setActiveSegmentIndex(index);
    const seg = result?.segments[index];
    if (seg && transcriptRef.current) {
      const el = transcriptRef.current.children[index] as HTMLElement | undefined;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function handleReset() {
    setUrl("");
    setResult(null);
    setActiveSegmentIndex(null);
    setStatus({ phase: "idle" });
  }

  const isLoading = status.phase === "processing";
  const pct = stats && stats.planLimit > 0 ? Math.round((stats.usedThisMonth / stats.planLimit) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8">
        {/* Top row: form left, pod usage right */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Transcription form */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-xl bg-black/5 p-2.5">
              <Sparkles className="h-5 w-5 text-black" />
            </div>
            <div>
              <h2 className="font-sans text-lg font-bold text-black">New Transcription</h2>
              <p className="font-sans text-xs text-gray-400">Paste a Spotify episode URL</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a Spotify episode URL..."
                className="font-sans flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-[#111111] placeholder-gray-400 transition-all focus:border-black focus:outline-none focus:ring-1 focus:ring-black/10 disabled:opacity-50"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !url.trim()}
                className="font-sans flex items-center justify-center gap-2 rounded-xl bg-black px-5 py-3 text-sm font-medium text-white hover:bg-gray-900 transition-all disabled:cursor-not-allowed disabled:opacity-30 whitespace-nowrap shadow-sm"
              >
                {isLoading ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                    Processing...
                  </>
                ) : (
                  "Transcribe"
                )}
              </button>
              </div>

            {status.phase === "processing" && (
              <div className="font-mono text-xs text-gray-400 flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-black" />
                {status.message}
              </div>
            )}

            {status.phase === "error" && (
              <div className="font-sans rounded-xl border border-red-100 bg-red-50/40 px-4 py-3">
                <p className="text-xs font-medium text-red-600">{status.error}</p>
                {status.detail && (
                  <p className="mt-1 text-[11px] text-red-400 leading-normal">{status.detail}</p>
                )}
              </div>
            )}
          </form>

          {/* Inline result */}
          {result && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div className="min-w-0 flex-1 mr-4">
                  <p className="font-sans text-sm font-bold text-black truncate">{result.metadata.episodeTitle}</p>
                  <p className="font-sans text-xs text-gray-400">
                    {result.executionTime?.toFixed(1)}s
                                      </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      const content = showTimestamps && result.segments.length > 0
                        ? result.segments.map((seg) => `[${formatTime(seg.start)}] ${seg.text}`).join("\n")
                        : result.transcript;
                      const blob = new Blob([content], { type: "text/plain" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `${result.metadata.episodeTitle.replace(/[^a-zA-Z0-9 ]/g, "")}.txt`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    className="font-sans rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-black hover:text-black transition-all"
                  >
                    Download TXT ↓
                  </button>
                  <button
                    onClick={() => setShowTimestamps((prev) => !prev)}
                    className="font-sans rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-black hover:text-black transition-all"
                  >
                    {showTimestamps ? "Hide TS" : "Show TS"}
                  </button>
                </div>
              </div>
              <div
                ref={transcriptRef}
                className="font-sans max-h-[40vh] space-y-1 overflow-y-auto pr-2 rounded-xl bg-gray-50 p-4"
              >
                {result.segments.length === 0 ? (
                  <p className="text-sm leading-relaxed text-gray-800">{result.transcript}</p>
                ) : (
                  result.segments.map((seg, i) => (
                    <button
                      key={segmentKey(seg, i)}
                      onClick={() => handleSegmentClick(i)}
                      className={`flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-all ${activeSegmentIndex === i
                        ? "bg-[#FAFABA]/60 border-l-2 border-black"
                        : "hover:bg-white"
                      }`}
                    >
                      {showTimestamps && (
                        <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-gray-400">
                          [{formatTime(seg.start)}]
                        </span>
                      )}
                      <span className="text-sm leading-relaxed text-[#222222]">{seg.text}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Pod usage */}
        {stats && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)] h-fit">
            <div className="flex items-center gap-3 mb-5">
              <div className="rounded-xl bg-black/5 p-2.5">
                <Zap className="h-5 w-5 text-black" />
              </div>
              <div>
                <h2 className="font-sans text-lg font-bold text-black">Pod Usage</h2>
                <p className="font-sans text-xs text-gray-400">This month</p>
              </div>
            </div>

            <div className="flex items-baseline gap-1 mb-2">
              <span className="font-sans text-3xl font-bold text-black">{stats.usedThisMonth}</span>
              <span className="font-sans text-sm text-gray-400">
                / {stats.planLimit === Infinity ? "∞" : stats.planLimit}
              </span>
            </div>

            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-black rounded-full transition-all duration-500"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>

            <p className="font-sans text-xs text-gray-500">
              {stats.remaining > 0
                ? `${stats.remaining} pods remaining`
                : "No pods remaining"}
            </p>
          </div>
        )}
      </div>

      {/* History */}
      <div>
        <h2 className="font-sans text-lg font-bold text-black mb-4 flex items-center gap-2">
          <History className="h-5 w-5 text-gray-400" />
          History
        </h2>

        {history.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
            <FileText className="h-10 w-10 text-gray-200 mx-auto mb-4" />
            <h3 className="font-sans font-bold text-black mb-2">No transcriptions yet</h3>
            <p className="font-sans text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
              Paste a Spotify episode URL above to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <div
                key={item.id + item.timestamp}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.01)] hover:border-gray-300 transition-all"
              >
                <div className="flex items-start gap-4">
                  {thumbnails[item.id] && (
                    <img
                      src={thumbnails[item.id]}
                      alt=""
                      className="h-14 w-14 rounded-lg object-cover shrink-0 mt-0.5"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-sans font-bold text-black truncate">{item.episodeTitle}</h3>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="font-sans text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(item.timestamp)}
                      </span>
                      <span className="font-sans text-xs text-gray-400">{item.executionTime.toFixed(1)}s</span>
                                          </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openTranscript(item.id)}
                      className="font-sans shrink-0 rounded-xl border border-gray-200 p-2.5 text-gray-400 hover:border-black hover:text-black transition-all cursor-pointer"
                      title="View transcript"
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                    <a
                      href={item.spotifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans shrink-0 rounded-xl border border-gray-200 p-2.5 text-gray-400 hover:border-black hover:text-black transition-all"
                      title="Open in Spotify"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>

    {/* Transcript viewer modal */}
    {viewingEpisode && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
        onClick={(e) => { if (e.target === e.currentTarget) setViewingEpisode(null); }}
      >
        <div className="mx-auto w-full max-w-2xl max-h-[85vh] rounded-2xl border border-gray-200 bg-white shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 shrink-0">
            <h3 className="font-sans font-bold text-black truncate pr-4">
              {viewingLoading ? "Loading..." : viewingTranscript?.title ?? "Transcript"}
            </h3>
            <div className="flex items-center gap-2 shrink-0">
              {viewingTranscript && (
                <>
                  <button
                    onClick={() => setShowViewerTimestamps((v) => !v)}
                    className={`font-sans rounded-xl border px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                      showViewerTimestamps
                        ? "border-black text-black"
                        : "border-gray-200 text-gray-400 hover:border-black hover:text-black"
                    }`}
                    title="Toggle timestamps"
                  >
                    Timestamps
                  </button>
                  <button
                    onClick={() => {
                      const text = viewingTranscript.segments
                        .map((s) => `[${formatTime(s.start)}] ${s.text}`)
                        .join("\n\n");
                      const blob = new Blob([text], { type: "text/plain" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `${viewingTranscript.title.replace(/[^a-zA-Z0-9]/g, "_")}.txt`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    className="font-sans rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400 hover:border-black hover:text-black transition-all cursor-pointer"
                    title="Download as text file"
                  >
                    Download TXT
                  </button>
                </>
              )}
              <button
                onClick={() => setViewingEpisode(null)}
                className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:border-black hover:text-black transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto px-6 py-5 flex-1">
            {viewingLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-black" />
              </div>
            ) : viewingTranscript ? (
              <div className="space-y-3">
                {viewingTranscript.segments.map((seg, i) => (
                  <div key={segmentKey(seg, i)} className="flex gap-3">
                    {showViewerTimestamps && (
                      <span className="font-mono text-xs text-gray-400 mt-0.5 shrink-0 w-14 text-right tabular-nums">
                        {formatTime(seg.start)}
                      </span>
                    )}
                    <p className="font-sans text-sm text-gray-700 leading-relaxed">
                      {seg.text}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-sans text-sm text-gray-500 text-center py-12">
                Could not load transcript.
              </p>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Settings Tab                                                       */
/* ------------------------------------------------------------------ */

interface BillingData {
  urls: {
    customerPortal: string;
    updatePaymentMethod: string | null;
    updateSubscription: string | null;
  } | null;
  subscriptions: {
    id: string;
    productName: string;
    status: string;
    renewsAt: string;
  }[];
  orders: {
    id: string;
    productName: string;
    totalFormatted: string;
    createdAt: string;
  }[];
}

function SettingsTab({ email }: { email: string }) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [cpCurrent, setCpCurrent] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");
  const [cpError, setCpError] = useState("");
  const [cpSuccess, setCpSuccess] = useState("");
  const [cpLoading, setCpLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((r) => r.json()),
      fetch("/api/lemon/billing").then((r) => r.json()),
    ])
      .then(([s, b]) => {
        setStats(s);
        setBilling(b);
      })
      .catch(() => {});
  }, []);

  const planName = stats?.plan === "free" ? "Free" : stats?.plan === "pro" ? "Pro" : "PayGo";
  const planPrice = stats?.plan === "free" ? "$0 / month" : stats?.plan === "pro" ? `$${((stats.planLimit ?? 30) * getProTier(stats.planLimit ?? 30)).toFixed(2)} / month` : "Prepaid credits";
  const creditsInfo = stats?.plan === "credits" ? `${stats.creditsRemaining} credits remaining` : null;

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setCpError("");
    setCpSuccess("");

    if (!cpCurrent || !cpNew) {
      setCpError("All fields are required.");
      return;
    }
    if (cpNew.length < 6) {
      setCpError("New password must be at least 6 characters.");
      return;
    }
    if (cpNew !== cpConfirm) {
      setCpError("New passwords do not match.");
      return;
    }

    setCpLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: cpCurrent, newPassword: cpNew }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCpError(data.error || "Failed to change password.");
      } else {
        setCpSuccess("Password changed successfully.");
        setCpCurrent("");
        setCpNew("");
        setCpConfirm("");
      }
    } catch {
      setCpError("Something went wrong.");
    }
    setCpLoading(false);
  }

  return (
    <>
    <div className="space-y-6">
      {/* Current plan */}
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-xl bg-black/5 p-2.5">
            <CreditCard className="h-5 w-5 text-black" />
          </div>
          <div>
            <h2 className="font-sans text-lg font-bold text-black">Current Plan</h2>
            <p className="font-sans text-xs text-gray-400">Your subscription and billing</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 border border-gray-100">
          <div>
            <p className="font-sans font-bold text-black">{planName}</p>
            <p className="font-sans text-sm text-gray-500 mt-0.5">{planPrice}</p>
            {creditsInfo && (
              <p className="font-sans text-xs text-gray-400 mt-1">{creditsInfo}</p>
            )}
          </div>
          <Link
            href="/pricing"
            className="font-sans text-sm font-medium text-black hover:text-gray-600 transition-colors underline underline-offset-2"
          >
            Change plan
          </Link>
        </div>

        {stats && (
          <div className="mt-4 p-4 rounded-xl bg-gray-50 border border-gray-100">
            <p className="font-sans text-sm text-gray-600">
              <span className="font-medium text-black">{stats.usedThisMonth}</span> of{" "}
              <span className="font-medium text-black">{stats.planLimit === Infinity ? "unlimited" : stats.planLimit}</span>{" "}
              pods used this month
            </p>
          </div>
        )}
      </div>

      {/* Payment methods */}
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
        <h3 className="font-sans font-bold text-black mb-4">Billing</h3>
        <div className="p-6 rounded-xl bg-gray-50 border border-gray-100">
          <p className="font-sans text-sm text-gray-600 leading-relaxed">
            Payments are processed securely through Lemon Squeezy. {billing?.subscriptions?.length ? "Manage your subscription, update your payment method, or view billing history below." : "Visit the store to purchase pods or manage your billing."}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            {billing?.urls?.customerPortal ? (
              <>
                <a
                  href={billing.urls.customerPortal}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-sans inline-flex items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-900 transition-all"
                >
                  Manage Billing
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {billing.urls.updatePaymentMethod && (
                  <a
                    href={billing.urls.updatePaymentMethod}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-sans inline-flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all"
                  >
                    Update Card
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </>
            ) : (
              <a
                href="https://tranzkript.lemonsqueezy.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-sans inline-flex items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-900 transition-all"
              >
                Visit Store
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {stats?.plan === "credits" && (
              <Link
                href="/pricing"
                className="font-sans inline-flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all"
              >
                Buy more credits
              </Link>
            )}
            {(!stats || stats?.plan === "free") && (
              <Link
                href="/pricing"
                className="font-sans inline-flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all"
              >
                Upgrade
              </Link>
            )}
          </div>
          {billing?.subscriptions?.map((sub) => {
            const d = sub.renewsAt ? new Date(sub.renewsAt) : null;
            const renews = d
              ? `${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })} ${d.getFullYear()}`
              : "";
            return (
              <div key={sub.id} className="font-sans mt-3 text-xs text-gray-400">
                {sub.productName} — active{renews ? `, renews ${renews}` : ""}
              </div>
            );
          })}
        </div>
      </div>

      {/* Account */}
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
        <h3 className="font-sans font-bold text-black mb-1">Account</h3>
        <p className="font-sans text-xs text-gray-400 mb-5">Update your account password</p>

        <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
          <input
            type="password"
            placeholder="Current password"
            value={cpCurrent}
            onChange={(e) => setCpCurrent(e.target.value)}
            className="font-sans w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-black focus:outline-none focus:ring-1 focus:ring-black/10"
          />
          <input
            type="password"
            placeholder="New password"
            value={cpNew}
            onChange={(e) => setCpNew(e.target.value)}
            className="font-sans w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-black focus:outline-none focus:ring-1 focus:ring-black/10"
          />
          <input
            type="password"
            placeholder="Repeat new password"
            value={cpConfirm}
            onChange={(e) => setCpConfirm(e.target.value)}
            className="font-sans w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-black focus:outline-none focus:ring-1 focus:ring-black/10"
          />

          {cpError && <p className="font-sans text-xs text-red-500">{cpError}</p>}
          {cpSuccess && <p className="font-sans text-xs text-green-600">{cpSuccess}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={cpLoading}
              className="font-sans rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-900 transition-all disabled:opacity-50 cursor-pointer"
            >
              {cpLoading ? "Updating..." : "Update Password"}
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="font-sans rounded-xl border border-red-200 px-5 py-2.5 text-sm font-medium text-red-500 hover:border-red-400 hover:bg-red-50 transition-all cursor-pointer"
            >
              Delete account
            </button>
          </div>
        </form>
      </div>
    </div>

    {/* Delete confirmation modal */}
    {showDeleteConfirm && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
        onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteConfirm(false); }}
      >
        <div className="mx-auto w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl">
          <h3 className="font-sans text-lg font-bold text-black mb-3">Delete account</h3>
          <p className="font-sans text-sm text-gray-600 leading-relaxed mb-2">
            Are you sure you want to delete your account? This will permanently remove:
          </p>
          <ul className="font-sans text-sm text-gray-600 leading-relaxed mb-6 list-disc pl-5 space-y-1">
            <li>Your account and profile</li>
            <li>All your transcriptions</li>
            <li>All saved data associated with your account</li>
          </ul>
          <p className="font-sans text-sm font-medium text-red-500 mb-6">
            This action cannot be undone.
          </p>

          {deleteError && (
            <p className="font-sans text-xs text-red-500 mb-4">{deleteError}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => { setShowDeleteConfirm(false); setDeleteError(""); }}
              disabled={deleteLoading}
              className="font-sans flex-1 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setDeleteLoading(true);
                setDeleteError("");
                try {
                  const res = await fetch("/api/auth/delete-account", { method: "POST" });
                  const data = await res.json();
                  if (!res.ok) {
                    setDeleteError(data.error || "Failed to delete account.");
                    setDeleteLoading(false);
                    return;
                  }
                  // Sign out and redirect to home
                  await signOut({ redirect: false });
                  window.location.href = "/";
                } catch {
                  setDeleteError("Something went wrong. Please try again.");
                  setDeleteLoading(false);
                }
              }}
              disabled={deleteLoading}
              className="font-sans flex-1 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-600 transition-all disabled:opacity-50 cursor-pointer"
            >
              {deleteLoading ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white mr-2" />
                  Deleting...
                </>
              ) : (
                "Yes, delete my account"
              )}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

