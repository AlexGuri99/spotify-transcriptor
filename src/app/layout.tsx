import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import iconAsset from "@/assets/icon.svg";
import AuthProvider from "./auth-provider";

const barlowCondensed = localFont({
  src: [
    {
      path: "../../font/BarlowCondensed-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../font/BarlowCondensed-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../font/BarlowCondensed-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-barlow-condensed",
});

export const metadata: Metadata = {
  title: {
    default: "Tranzkript — Extract Transcripts from Spotify Podcast Episodes",
    template: "%s — Tranzkript",
  },
  description:
    "Convert any public Spotify podcast episode into a clean, readable transcript with timestamps. AI-powered ad removal, text export, and more. No sign-up required to get started.",
  icons: {
    icon: [
      {
        url: iconAsset.src,
        type: "image/svg+xml",
      },
    ],
  },
  openGraph: {
    title: "Tranzkript — Extract Transcripts from Spotify Podcast Episodes",
    description:
      "Convert any public Spotify podcast episode into a clean, readable transcript with timestamps. AI-powered ad removal, text export, and more.",
    url: "https://www.tranzkript.com",
    siteName: "Tranzkript",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tranzkript — Extract Transcripts from Spotify Podcast Episodes",
    description:
      "Convert any public Spotify podcast episode into a clean, readable transcript with timestamps.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={barlowCondensed.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}