import type { Metadata } from "next";
import "./globals.css";
import iconAsset from "@/assets/icon.svg";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}