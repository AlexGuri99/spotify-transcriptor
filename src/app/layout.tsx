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
  title: "Tranzkript",
  description: "Extract transcripts from Spotify podcast episodes",
  icons: {
    icon: [
      {
        url: iconAsset.src,
        type: "image/svg+xml",
      },
    ],
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