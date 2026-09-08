/**
 * The one page reachable without a session. `proxy.ts` exempts it by prefix.
 */
import { EMAIL_DOMAIN } from "@/agent/lib/auth.ts";
import { safeNext } from "@/agent/lib/gate.ts";
import { SignIn } from "@/app/_components/sign-in";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only ever a path on this origin — an open redirect here would let someone else's link carry a
  // becode sign-in to a site they own. `safeNext` is stricter than it looks for a reason it is
  // easy to get wrong; the cases are in `gate.check.ts`.
  return <SignIn domain={EMAIL_DOMAIN} next={safeNext(next)} />;
}
