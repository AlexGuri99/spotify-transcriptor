import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "Tranzkript's refund and cancellation policy for paid plans. Learn about your rights and how to request a refund.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function RefundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}