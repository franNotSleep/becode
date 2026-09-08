"use client";

/**
 * Who is signed in, and the way out.
 *
 * Renders nothing at all when there is no session — an instance running without
 * `BETTER_AUTH_SECRET` has no account to show, and an empty rail slot is the honest depiction of
 * that. Sign-out is behind a menu rather than on the button, because the rail is a column of
 * one-click actions and "log me out" is not one you want to hit by accident.
 */

import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

export function AccountButton() {
  const router = useRouter();
  const { data } = authClient.useSession();
  const email = data?.user.email;

  if (!email) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Signed in as ${email}`}
        className="grid size-8 shrink-0 place-items-center rounded-lg font-medium text-muted-foreground text-sm uppercase outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        title={email}
      >
        {email[0]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right">
        <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void authClient.signOut().then(() => {
              // The proxy decides on the server, so a client-side route change alone would keep
              // showing a page the next real request refuses.
              router.push("/login");
              router.refresh();
            });
          }}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
