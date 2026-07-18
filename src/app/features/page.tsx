"use client";

import { Newsreader, Inter } from "next/font/google";
import { Videotape, Sparkles, Search, Clock, Shield, Download } from "lucide-react";
import Link from "next/link";

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

const features = [
  {
    icon: Search,
    title: "Instant transcripts",
    desc: "Paste any public Spotify podcast URL and get a full, clean transcript in seconds — no login, no setup.",
  },
  {
    icon: Clock,
    title: "Timeline navigation",
    desc: "Every segment is timestamped. Click any line to jump straight to that moment in the transcript.",
  },
  {
    icon: Shield,
    title: "Ad-free reading",
    desc: "Optional AI-powered filtering strips out sponsor reads and ad segments so you get pure content.",
  },
  {
    icon: Download,
    title: "Export to text",
    desc: "Download any transcript as a .txt file with one click. Read offline, archive, or feed into your own tools.",
  },
  ];

export default function FeaturesPage() {
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
            <Link href="/features" className="text-black">Features</Link>
            <span className="cursor-not-allowed opacity-40">Api</span>
            <span className="cursor-not-allowed opacity-40">Docs</span>
            <span className="cursor-not-allowed opacity-40">Dashboard</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-8 py-20">
        <div className="text-center mb-16">
          <h1 className={`text-4xl md:text-5xl font-bold italic tracking-tight leading-[1.1] text-black ${editorialSerif.className} font-editorial`}>
            Who is Tranzkript for?
          </h1>
          <p className="font-sans text-lg text-gray-500 mt-4 max-w-2xl mx-auto leading-relaxed">
            Researchers, podcast enthusiasts, writers, and anyone who wants to search, quote, or
            reference spoken content without listening to the whole episode.
          </p>
        </div>

        <div className="text-center mb-20">
          <div className="inline-block rounded-2xl border border-gray-200 bg-white px-8 py-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
            <p className="font-sans text-lg text-gray-600 italic leading-relaxed">
              &ldquo;Other transcribers make you jump through hoops — signups, API keys, monthly limits.
              Tranzkript just works: paste a link, get a transcript. No friction.&rdquo;
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)] hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="shrink-0 rounded-xl bg-black/5 p-2.5">
                  <feature.icon className="h-5 w-5 text-black" />
                </div>
                <div>
                  <h3 className="font-sans font-bold text-black">{feature.title}</h3>
                  <p className="font-sans text-sm text-gray-500 mt-1 leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-16">
          <Link
            href="/"
            className="font-sans inline-flex items-center gap-2 rounded-xl bg-black px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-gray-900 shadow-sm"
          >
            <Sparkles className="h-4 w-4" />
            Try it now
          </Link>
        </div>
      </main>

      <footer className="border-t border-gray-100 bg-white px-8 py-5 text-center font-sans text-[11px] font-medium text-gray-400">
        Not affiliated with Spotify Corporation · Made by Alex Gurinovich
      </footer>
    </div>
  );
}