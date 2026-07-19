"use client";

import { useSession, signOut } from "next-auth/react";
import { redirect } from "next/navigation";
import { Newsreader, Inter } from "next/font/google";
import Link from "next/link";
import { Videotape, LogOut } from "lucide-react";

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

export default function DashboardPage() {
  const { data: session } = useSession();

  if (!session?.user) {
    redirect("/");
  }

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
            <button onClick={() => signOut()} className="flex items-center gap-1.5 hover:text-black transition-colors cursor-pointer bg-transparent border-none">
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-8 py-20">
        <div className="text-center mb-16">
          <h1 className={`text-4xl md:text-5xl font-bold italic tracking-tight leading-[1.1] text-black ${editorialSerif.className}`}>
            Dashboard
          </h1>
          <p className="font-sans text-lg text-gray-500 mt-4 max-w-2xl mx-auto leading-relaxed">
            Welcome back, {session.user.name}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-12 shadow-[0_4px_24px_rgba(0,0,0,0.01)] text-center">
          <p className="font-sans text-gray-400 text-sm">
            Your transcripts will appear here. Coming soon.
          </p>
        </div>
      </main>

      <footer className="border-t border-gray-100 bg-white px-8 py-5 text-center font-sans text-[11px] font-medium text-gray-400">
        Not affiliated with Spotify Corporation · Made by Alex Gurinovich
      </footer>
    </div>
  );
}