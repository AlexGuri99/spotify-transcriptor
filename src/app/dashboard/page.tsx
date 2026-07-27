"use client";

import { useState, useEffect, useCallback, useRef, FormEvent } from "react";
import { useSession, signOut } from "next-auth/react";
import { redirect } from "next/navigation";
import { Newsreader, Inter } from "next/font/google";
import Link from "next/link";
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
}

interface UsageStats {
  usedThisMonth: number;
  total: number;
  planLimit: number;
  remaining: number;
  plan: string;
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

      <footer className="border-t border-gray-100 bg-white px-8 py-5 text-center font-sans text-[11px] font-medium text-gray-400">
        Not affiliated with Spotify Corporation · Made by Alex Gurinovich
      </footer>
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
  const [filterAds, setFilterAds] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((r) => r.json()),
      fetch("/api/dashboard/history").then((r) => r.json()),
    ])
      .then(([statsData, historyData]) => {
        setStats(statsData);
        setHistory(historyData.history || []);
        setLoading(false);
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
                setHistory(h.history || []);
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
                <div className="flex items-start justify-between gap-4">
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
                  <a
                    href={item.spotifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-sans shrink-0 rounded-xl border border-gray-200 p-2.5 text-gray-400 hover:border-black hover:text-black transition-all"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings Tab                                                       */
/* ------------------------------------------------------------------ */

function SettingsTab({ email }: { email: string }) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [cpCurrent, setCpCurrent] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");
  const [cpError, setCpError] = useState("");
  const [cpSuccess, setCpSuccess] = useState("");
  const [cpLoading, setCpLoading] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const planName = stats?.plan === "free" ? "Free" : stats?.plan === "pro" ? "Pro" : "Credits";
  const planPrice = stats?.plan === "free" ? "$0" : stats?.plan === "pro" ? "From $2.25/mo" : "$0.20/pod";

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

      {/* Change password */}
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
        <h3 className="font-sans font-bold text-black mb-1">Change Password</h3>
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

          <button
            type="submit"
            disabled={cpLoading}
            className="font-sans rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-900 transition-all disabled:opacity-50 cursor-pointer"
          >
            {cpLoading ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>

      {/* Payment methods - placeholder */}
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
        <h3 className="font-sans font-bold text-black mb-4">Payment Methods</h3>
        <div className="p-6 rounded-xl bg-gray-50 border border-gray-100 text-center">
          <p className="font-sans text-sm text-gray-400">
            Payments are not live yet. You can continue using the free tier while we set up billing.
          </p>
        </div>
      </div>
    </div>
  );
}

