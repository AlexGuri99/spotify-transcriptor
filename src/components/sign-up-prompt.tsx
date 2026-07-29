"use client";

import { Sparkles } from "lucide-react";

interface SignUpPromptProps {
  open: boolean;
  onContinue: () => void;
  onDismiss: () => void;
}

export default function SignUpPrompt({ open, onContinue, onDismiss }: SignUpPromptProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onDismiss()}
    >
      <div className="mx-4 w-full max-w-md rounded-3xl border border-gray-100 bg-white p-10 shadow-2xl text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-black to-gray-700 shadow-lg">
          <Sparkles className="h-6 w-6 text-white" />
        </div>

        <h2 className="font-sans text-2xl font-bold text-black mb-2">
          Your transcript is ready to go
        </h2>

        <p className="font-sans text-base text-gray-500 leading-relaxed mb-2">
          Just one small step — create a free account to unlock it.
        </p>

        <div className="bg-gray-50 rounded-2xl px-5 py-4 mb-7 mx-auto inline-block">
          <p className="font-sans text-sm text-gray-600">
            <span className="font-semibold text-black">5 free transcriptions</span> every month.
            No credit card. No commitment.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={onContinue}
            className="font-sans w-full rounded-xl bg-black px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-gray-900 shadow-sm cursor-pointer"
          >
            Continue with email or Google
          </button>
          <button
            onClick={onDismiss}
            className="font-sans w-full rounded-xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-500 transition-all hover:border-black hover:text-black cursor-pointer"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}