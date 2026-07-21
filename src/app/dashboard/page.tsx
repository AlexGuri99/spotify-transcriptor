"use client";

import { useState, useEffect, useCallback } from "react";
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
  Key,
  ExternalLink,
  Copy,
  Check,
  Trash2,
  Plus,
  Clock,
  Zap,
  FileText,
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
  showName: string;
  spotifyUrl: string;
  timestamp: string;
  executionTime: number;
  adFiltered: boolean;
}

interface UsageStats {
  usedThisMonth: number;
  total: number;
  planLimit: number;
  remaining: number;
  plan: string;
}

interface ApiKey {
  key: string;
  label: string;
  created: string;
  lastUsed: string | null;
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function maskKey(key: string): string {
  if (key.length <= 8) return key;
  return key.slice(0, 8) + "..." + key.slice(-4);
}

/* ------------------------------------------------------------------ */
/* Tabs                                                               */
/* ------------------------------------------------------------------ */

type Tab = "usage" | "billing" | "api";

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "usage", label: "Usage & History", icon: BarChart3 },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "api", label: "API Keys", icon: Key },
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
  const [activeTab, setActiveTab] = useState<Tab>("usage");

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
            Welcome back, {session.user.name}
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
        {activeTab === "usage" && <UsageHistoryTab email={session.user.email!} />}
        {activeTab === "billing" && <BillingTab email={session.user.email!} />}
        {activeTab === "api" && <ApiTab email={session.user.email!} />}
      </main>

      <footer className="border-t border-gray-100 bg-white px-8 py-5 text-center font-sans text-[11px] font-medium text-gray-400">
        Not affiliated with Spotify Corporation · Made by Alex Gurinovich
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Usage Tab                                                          */
/* ------------------------------------------------------------------ */

function UsageHistoryTab({ email: _email }: { email: string }) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
      </div>
    );
  }

  const pct = stats && stats.planLimit > 0 ? Math.round((stats.usedThisMonth / stats.planLimit) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Pod usage */}
      {stats && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
          <div className="flex items-center gap-3 mb-6">
            <div className="rounded-xl bg-black/5 p-2.5">
              <Zap className="h-5 w-5 text-black" />
            </div>
            <div>
              <h2 className="font-sans text-lg font-bold text-black">Pod Usage</h2>
              <p className="font-sans text-xs text-gray-400">This month</p>
            </div>
          </div>

          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-sans text-4xl font-bold text-black">{stats.usedThisMonth}</span>
            <span className="font-sans text-sm text-gray-400">
              / {stats.planLimit === Infinity ? "∞" : stats.planLimit} pods used
            </span>
          </div>

          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-black rounded-full transition-all duration-500"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>

          <p className="font-sans text-sm text-gray-500">
            {stats.remaining > 0
              ? `${stats.remaining} pods remaining this month`
              : "No pods remaining this month"}
          </p>
        </div>
      )}

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
              Your transcription history will appear here. Head back to the home page to transcribe your first episode.
            </p>
            <Link
              href="/"
              className="font-sans inline-flex items-center gap-2 mt-6 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-900 transition-all"
            >
              <Videotape className="h-4 w-4" />
              Transcribe an episode
            </Link>
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
                    <h3 className="font-sans font-bold text-black truncate">
                      {item.episodeTitle}
                    </h3>
                    {item.showName && (
                      <p className="font-sans text-sm text-gray-400 mt-0.5">{item.showName}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="font-sans text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(item.timestamp)}
                      </span>
                      <span className="font-sans text-xs text-gray-400">
                        {item.executionTime.toFixed(1)}s
                      </span>
                      {item.adFiltered && (
                        <span className="font-sans text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                          Ad-filtered
                        </span>
                      )}
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
/* Billing Tab                                                        */
/* ------------------------------------------------------------------ */

function BillingTab({ email: _email }: { email: string }) {
  const [stats, setStats] = useState<UsageStats | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const planName = stats?.plan === "free" ? "Free" : stats?.plan === "pro" ? "Pro" : "Credits";
  const planPrice = stats?.plan === "free" ? "$0" : stats?.plan === "pro" ? "From $2.25/mo" : "$0.20/pod";

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

/* ------------------------------------------------------------------ */
/* API Keys Tab                                                       */
/* ------------------------------------------------------------------ */

function ApiTab({ email: _email }: { email: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadKeys = useCallback(() => {
    fetch("/api/dashboard/api-key")
      .then((r) => r.json())
      .then((data) => {
        setKeys(data.keys || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/dashboard/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() }),
      });
      const data = await res.json();
      if (data.key) {
        setKeys((prev) => [...prev, data.key]);
        setCopiedKey(data.key.key);
        setTimeout(() => setCopiedKey(null), 3000);
      }
    } catch {}
    setCreating(false);
    setNewLabel("");
    setShowNew(false);
  };

  const handleDelete = async (key: string) => {
    await fetch("/api/dashboard/api-key", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    setKeys((prev) => prev.filter((k) => k.key !== key));
  };

  const handleCopy = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-black/5 p-2.5">
              <Key className="h-5 w-5 text-black" />
            </div>
            <div>
              <h2 className="font-sans text-lg font-bold text-black">API Keys</h2>
              <p className="font-sans text-xs text-gray-400">Manage your API access tokens</p>
            </div>
          </div>
          <button
            onClick={() => setShowNew(!showNew)}
            className="font-sans flex items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 transition-all"
          >
            <Plus className="h-4 w-4" />
            New Key
          </button>
        </div>

        {showNew && (
          <div className="mb-6 p-4 rounded-xl bg-gray-50 border border-gray-100">
            <p className="font-sans text-sm font-medium text-black mb-3">Create a new API key</p>
            <div className="flex gap-3">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Label (e.g. My App)"
                className="font-sans flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-[#111111] placeholder-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black/10"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newLabel.trim()}
                className="font-sans rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-900 transition-all disabled:opacity-30"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        )}

        {keys.length === 0 ? (
          <div className="p-8 text-center">
            <Key className="h-8 w-8 text-gray-200 mx-auto mb-3" />
            <p className="font-sans text-sm text-gray-500">No API keys yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map((apiKey) => (
              <div
                key={apiKey.key}
                className="flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:border-gray-200 transition-all"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-sans text-sm font-medium text-black">{apiKey.label}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <code className="font-mono text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded">
                      {maskKey(apiKey.key)}
                    </code>
                    <span className="font-sans text-xs text-gray-400">
                      Created {timeAgo(apiKey.created)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleCopy(apiKey.key)}
                    className="rounded-xl border border-gray-200 p-2 text-gray-400 hover:border-black hover:text-black transition-all"
                    title="Copy key"
                  >
                    {copiedKey === apiKey.key ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(apiKey.key)}
                    className="rounded-xl border border-gray-200 p-2 text-gray-400 hover:border-red-300 hover:text-red-500 transition-all"
                    title="Delete key"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage info */}
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
        <h3 className="font-sans font-bold text-black mb-2">Using the API</h3>
        <p className="font-sans text-sm text-gray-500 leading-relaxed">
          Use your API key to authenticate requests to the Tranzkript API. Include it in the
          <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mx-1">Authorization</code>
          header as <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mx-1">Bearer tk_...</code>.
        </p>
        <div className="mt-4 p-4 rounded-xl bg-gray-50 border border-gray-100">
          <p className="font-sans text-xs font-medium text-gray-400 mb-2">Quick example:</p>
          <code className="font-mono text-xs text-gray-600 block leading-relaxed">
            curl -X POST https://tranzkript.app/api/transcribe \<br />
            &nbsp;&nbsp;-H "Authorization: Bearer tk_your_key_here" \<br />
            &nbsp;&nbsp;-H "Content-Type: application/json" \<br />
            &nbsp;&nbsp;-d '{'"url": "https://open.spotify.com/episode/..."'}'
          </code>
        </div>
      </div>
    </div>
  );
}