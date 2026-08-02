"use client";

import { X } from "lucide-react";
import { signIn } from "next-auth/react";
import { useEffect, useRef, useState, FormEvent } from "react";

interface SignInModalProps {
  open: boolean;
  onClose: () => void;
  defaultMode?: "signin" | "signup";
  onSignedIn?: () => void;
}

type Mode = "signin" | "signup";

export default function SignInModal({ open, onClose, defaultMode = "signin", onSignedIn }: SignInModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  /* Reset form when modal opens/closes or mode toggles */
  useEffect(() => {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setError("");
    setLoading(false);
  }, [open, mode]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Sign up failed.");
          setLoading(false);
          return;
        }
      }

      /* Sign in with credentials (both modes end here) */
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password.");
        setLoading(false);
        return;
      }

      if (onSignedIn) {
        onSignedIn();
      } else {
        window.location.href = "/dashboard";
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-sans text-xl font-bold text-black">
            {mode === "signin" ? "Sign in to Tranzkript" : "Sign up — it's free"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:border-black hover:text-black transition-all cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {mode === "signup" && (
          <p className="font-sans text-sm text-gray-500 mb-6 leading-relaxed">
            No credit card needed. You get <strong>5 free transcriptions</strong> every month.
          </p>
        )}

        {/* Email / Password form */}
        <form onSubmit={handleSubmit} className="space-y-3 mb-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="font-sans w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-black focus:outline-none focus:ring-1 focus:ring-black/10"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="font-sans w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-black focus:outline-none focus:ring-1 focus:ring-black/10"
          />

          {mode === "signup" && (
            <input
              type="password"
              placeholder="Repeat password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="font-sans w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-black focus:outline-none focus:ring-1 focus:ring-black/10"
            />
          )}

          {error && (
            <p className="font-sans text-xs text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="font-sans flex w-full items-center justify-center rounded-xl bg-black px-4 py-3 text-sm font-medium text-white transition-all hover:bg-gray-900 disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white mr-2" />
                {mode === "signin" ? "Signing in..." : "Creating account..."}
              </>
            ) : mode === "signin" ? (
              "Sign in with email"
            ) : (
              "Create account"
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 border-t border-gray-100" />
          <span className="font-sans text-xs text-gray-400">or continue with</span>
          <div className="flex-1 border-t border-gray-100" />
        </div>

        {/* OAuth buttons */}
        <div className="space-y-3">
          <button
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            className="font-sans flex w-full items-center justify-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all cursor-pointer"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>

        {/* Mode toggle */}
        <p className="font-sans text-xs text-gray-400 text-center mt-6">
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => setMode("signup")}
                className="text-black underline hover:no-underline cursor-pointer"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("signin")}
                className="text-black underline hover:no-underline cursor-pointer"
              >
                Sign in
              </button>
            </>
          )}
        </p>

        <p className="font-sans text-xs text-gray-400 text-center mt-4 leading-relaxed">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}