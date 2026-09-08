"use client";

/**
 * Two steps, one field each: the address, then the code that lands in its inbox.
 *
 * Written for someone who does not think of themselves as a technical person, so the failure
 * modes are sentences rather than statuses — "That code is wrong or has expired" and not "401".
 * The address step keeps its value when the code step is showing, because the most common repair
 * is a typo in the address and retyping it is the wrong penalty for that.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { OTPInput, type OTPStatus } from "@/components/motion/otp-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

/** The message a caller gets back, or a sentence of our own if it arrives empty. */
const reason = (error: { message?: string } | null | undefined, fallback: string) =>
  error?.message?.trim() || fallback;

export function SignIn({ next, domain }: { readonly next: string; readonly domain: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<OTPStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(undefined);
    // Clears a stale "that code was wrong" once a new code is on its way, and — with the branch
    // below — is what makes a *failed* resend visible at all: on the code step the only error
    // surface is the OTP field, and it renders its message only while the status is "error".
    setStatus("idle");

    const { error: failed } = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "sign-in",
    });

    setBusy(false);
    if (failed) {
      setError(reason(failed, "Could not send the code. Try again in a moment."));
      if (sent) setStatus("error");
      return;
    }
    setCode("");
    setSent(true);
  };

  const verify = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setStatus("idle");

    const { error: failed } = await authClient.signIn.emailOtp({ email: email.trim(), otp: value });

    setBusy(false);
    if (failed) {
      setStatus("error");
      setCode("");
      setError(reason(failed, "That code is wrong or has expired. Ask for a new one."));
      return;
    }

    setStatus("success");
    // `refresh` as well as `push`: the proxy decided this route was closed on the way in, and only
    // a fresh server round trip re-runs it with the cookie now set.
    router.push(next);
    router.refresh();
  };

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-medium text-2xl tracking-tight">becode</h1>

        {sent ? (
          <>
            <p className="mt-2 text-muted-foreground text-sm">
              We sent a six-digit code to <span className="text-foreground">{email.trim()}</span>. It
              expires in ten minutes.
            </p>

            <div className="mt-8">
              <OTPInput
                aria-label="Sign-in code"
                autoFocus
                disabled={busy}
                errorMessage={error}
                onChange={(value) => {
                  setCode(value);
                  if (status === "error") setStatus("idle");
                }}
                onComplete={verify}
                status={status}
                value={code}
              />
            </div>

            <div className="mt-8 flex items-center justify-between">
              <Button
                className="-ml-2 text-muted-foreground"
                disabled={busy}
                onClick={() => {
                  setSent(false);
                  setCode("");
                  setStatus("idle");
                  setError(undefined);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ArrowLeftIcon />
                Use a different address
              </Button>
              <Button disabled={busy} onClick={() => void send()} size="sm" type="button" variant="ghost">
                Send another code
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={send}>
            <p className="mt-2 text-muted-foreground text-sm">
              Sign in with your @{domain} address. We will email you a code — there is no password.
            </p>

            <Input
              aria-label="Email address"
              autoComplete="email"
              autoFocus
              className="mt-8"
              disabled={busy}
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder={`you@${domain}`}
              type="email"
              value={email}
            />

            {error ? <p className="mt-3 text-destructive text-sm">{error}</p> : null}

            <Button className="mt-4 w-full" disabled={busy || !email.trim()} type="submit">
              {busy ? "Sending…" : "Email me a code"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
