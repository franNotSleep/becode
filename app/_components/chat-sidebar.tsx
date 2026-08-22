"use client";

import {
  ChevronRightIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type ProjectChats = {
  id: string;
  chats: { sessionId: string; title: string; branch?: string; lastModified: number }[];
};

/**
 * Projects, and the chats under each.
 *
 * ponytail: a two-level list, not `@beui/ai-sidebar`. That component has no trailing-action slot
 * for the `+`, no controlled expansion (so a collapsed row cannot be re-opened from state), and a
 * drag-to-move affordance that would be a lie here — a chat belongs to the worktree it created.
 * Working around three of its four features costs more than the eighty lines below.
 */
export function ChatSidebar({
  activeChatId,
  activeProjectId,
  liveBranch,
  onAddProject,
  onNewChat,
  onOpenChat,
  reloadKey,
}: {
  readonly activeChatId?: string;
  readonly activeProjectId?: string;
  readonly liveBranch?: string;
  readonly onNewChat: (projectId?: string) => void;
  readonly onAddProject: (repoPath: string) => void;
  readonly onOpenChat: (sessionId: string, projectId: string) => void;
  /** Bumped by the chat when a turn finishes, so a new chat appears without a reload. */
  readonly reloadKey: number;
}) {
  const [projects, setProjects] = useState<ProjectChats[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string>();
  const [addingProject, setAddingProject] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/sessions").catch(() => null);
    if (!response?.ok) return;
    const data = (await response.json()) as { projects: ProjectChats[] };
    setProjects(data.projects);
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const rename = async (sessionId: string, title: string) => {
    setRenaming(undefined);
    if (!title.trim()) return;
    await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await load();
  };

  const remove = async (projectId: string, sessionId: string) => {
    await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    if (sessionId === activeChatId) onNewChat(projectId);
    await load();
  };

  return (
    <nav
      aria-label="Projects and chats"
      className="flex h-full w-64 shrink-0 flex-col border-border/60 border-r px-2 py-3"
    >
      <button
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
        onClick={() => onNewChat(activeProjectId)}
        type="button"
      >
        <SquarePenIcon className="size-4 text-muted-foreground" />
        New chat
      </button>

      <div className="group/head flex items-center gap-1 px-2 pt-5 pb-1">
        <span className="flex-1 text-muted-foreground text-xs">Projects</span>
        <button
          aria-label="Add a project"
          className="hidden size-5 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:grid group-hover/head:grid"
          onClick={() => setAddingProject(true)}
          type="button"
        >
          <FolderPlusIcon className="size-3.5" />
        </button>
      </div>

      {addingProject ? (
        // A browser cannot hand over a real folder path, so the person pastes one. becode then
        // reads that one folder — and nothing else — to work the boot recipe out.
        <input
          aria-label="Absolute path to a repo"
          autoFocus
          className="mx-2 mb-1 rounded-lg border border-border/80 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/55 focus:border-foreground/25"
          onBlur={() => setAddingProject(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setAddingProject(false);
            if (event.key !== "Enter") return;
            const value = event.currentTarget.value.trim();
            setAddingProject(false);
            if (value) onAddProject(value);
          }}
          placeholder="/Users/you/Dev/some-repo"
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {projects.map((project) => {
          const open = !collapsed.has(project.id);
          return (
            <div key={project.id}>
              <div className="group flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-muted/60">
                <button
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm"
                  onClick={() =>
                    setCollapsed((previous) => {
                      const next = new Set(previous);
                      if (!next.delete(project.id)) next.add(project.id);
                      return next;
                    })
                  }
                  type="button"
                >
                  <ChevronRightIcon
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  <span className="truncate">{project.id}</span>
                </button>
                <button
                  aria-label={`New chat in ${project.id}`}
                  className="hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:grid group-hover:grid"
                  onClick={() => onNewChat(project.id)}
                  type="button"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </div>

              {open
                ? project.chats.map((chat) => (
                    <div
                      className={cn(
                        "group flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-muted/60",
                        chat.sessionId === activeChatId && "bg-muted",
                      )}
                      key={chat.sessionId}
                    >
                      {renaming === chat.sessionId ? (
                        <input
                          aria-label="Chat name"
                          autoFocus
                          className="min-w-0 flex-1 bg-transparent py-1.5 pl-8 text-sm outline-none"
                          defaultValue={chat.title}
                          onBlur={(event) => void rename(chat.sessionId, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") setRenaming(undefined);
                          }}
                        />
                      ) : (
                        <button
                          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-8 text-left text-sm"
                          onClick={() => onOpenChat(chat.sessionId, project.id)}
                          onDoubleClick={() => setRenaming(chat.sessionId)}
                          title={chat.branch}
                          type="button"
                        >
                          {chat.branch === liveBranch ? (
                            <span
                              aria-label="showing in the browser"
                              className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                            />
                          ) : (
                            <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">{chat.title || "Untitled"}</span>
                        </button>
                      )}
                      <button
                        aria-label={`Rename ${chat.title}`}
                        className="hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:grid group-hover:grid"
                        onClick={() => setRenaming(chat.sessionId)}
                        type="button"
                      >
                        <SquarePenIcon className="size-3" />
                      </button>
                      <button
                        aria-label={`Delete ${chat.title}`}
                        className="hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-destructive focus-visible:grid group-hover:grid"
                        onClick={() => void remove(project.id, chat.sessionId)}
                        type="button"
                      >
                        <Trash2Icon className="size-3" />
                      </button>
                    </div>
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
