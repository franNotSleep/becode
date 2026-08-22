"use client";

import { CheckIcon, CornerLeftUpIcon, FolderIcon, GitBranchIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

type Listing = {
  path: string;
  parent: string | null;
  isRepo: boolean;
  added: boolean;
  entries: { name: string; path: string; isRepo: boolean; added: boolean }[];
};

/**
 * Pick a repo by browsing, not by typing a path.
 *
 * The listing comes from `GET /api/folders` because no browser API returns an absolute path — see
 * the note in that route. Clicking a row walks into it; adding is the explicit action at the top,
 * enabled only when the folder you are standing in is actually a git repo.
 */
export function ProjectPicker({
  onOpenChange,
  onPick,
  open,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (repoPath: string) => void;
  readonly open: boolean;
}) {
  const [listing, setListing] = useState<Listing>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");

  const browse = useCallback(async (target?: string) => {
    const url = target ? `/api/folders?path=${encodeURIComponent(target)}` : "/api/folders";
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) {
      setError((body as { message: string }).message);
      return;
    }
    setError(undefined);
    setSearch("");
    setListing(body as Listing);
  }, []);

  useEffect(() => {
    if (open) void browse();
  }, [browse, open]);

  const pick = (repoPath: string) => {
    onOpenChange(false);
    onPick(repoPath);
  };

  // The escape hatch: paste or type a path and go straight there, home-relative `~` included.
  const typedPath = search.startsWith("/") || search.startsWith("~") ? search.trim() : undefined;

  return (
    <CommandDialog
      description="Browse to a git repository becode should work on."
      onOpenChange={onOpenChange}
      open={open}
      title="Add a project"
    >
      <CommandInput
        onValueChange={setSearch}
        placeholder="Search this folder, or paste a path…"
        value={search}
      />
      <CommandList>
        {error ? <div className="px-3 py-6 text-center text-destructive text-sm">{error}</div> : null}

        {typedPath ? (
          <CommandGroup>
            <CommandItem onSelect={() => void browse(typedPath)} value={typedPath}>
              <CornerLeftUpIcon className="rotate-90" />
              Go to <span className="truncate font-mono text-xs">{typedPath}</span>
            </CommandItem>
          </CommandGroup>
        ) : null}

        {listing ? (
          <>
            <CommandGroup heading={listing.path.replace(/^\/Users\/[^/]+/, "~")}>
              <CommandItem
                disabled={!listing.isRepo || listing.added}
                onSelect={() => pick(listing.path)}
                value="__use_this_folder__"
              >
                <GitBranchIcon />
                {listing.added
                  ? "Already a becode project"
                  : listing.isRepo
                    ? "Use this folder"
                    : "Not a git repository — open one below"}
              </CommandItem>
              {listing.parent ? (
                <CommandItem
                  onSelect={() => void browse(listing.parent ?? undefined)}
                  value="__parent__"
                >
                  <CornerLeftUpIcon />
                  Up one folder
                </CommandItem>
              ) : null}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Folders">
              <CommandEmpty>Nothing here.</CommandEmpty>
              {listing.entries.map((entry) => (
                <CommandItem
                  key={entry.path}
                  onSelect={() => (entry.isRepo && !entry.added ? pick(entry.path) : void browse(entry.path))}
                  value={entry.name}
                >
                  {entry.isRepo ? <GitBranchIcon /> : <FolderIcon />}
                  <span className="truncate">{entry.name}</span>
                  {entry.added ? (
                    <span className="ml-auto flex items-center gap-1 text-muted-foreground text-xs">
                      <CheckIcon className="size-3" />
                      added
                    </span>
                  ) : entry.isRepo ? (
                    <span className="ml-auto text-muted-foreground text-xs">repo</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
