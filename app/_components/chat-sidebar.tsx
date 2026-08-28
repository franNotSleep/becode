"use client";

import {
  ChevronRightIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  PlusIcon,
  Settings2Icon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDesign } from "@/agent/lib/impeccable";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { DesignSystemCard } from "./design-system-card";
import { ProjectPicker } from "./project-picker";
import { ProjectSettings } from "./project-settings";

export type ProjectChats = {
  id: string;
  /** What becode knows about how this project looks. Rendered on the row by `DesignSystemCard`. */
  design: ProjectDesign;
  chats: { sessionId: string; title: string; branch?: string; lastModified: number }[];
};

/**
 * Projects, and the chats under each — collapsed to a rail until you reach for it.
 *
 * ponytail: a two-level list, not `@beui/ai-sidebar`. That component has no trailing-action slot
 * for the `+`, no controlled expansion (so a collapsed row cannot be re-opened from state), and a
 * drag-to-move affordance that would be a lie here — a chat belongs to the worktree it created.
 * Working around three of its four features costs more than the lines below.
 *
 * The tree opens *beside* the rail, never over it. At `left-0` it covered the 48px rail the
 * instant the pointer arrived, so mousedown landed on the panel and every rail button was dead to
 * the mouse — the control you were reaching for was gone before you could press it. Offsetting by
 * the rail's width also keeps the project you are in visible while you browse the others.
 *
 * The rail is new, and the reason is the anti-reference. Sidebar plus chat plus window is three
 * columns of chrome, which is the shape of the enterprise dashboard `DESIGN.md` rules out; and the
 * person this is for almost never runs two chats at once, so a permanent column spends the
 * viewport on a case that does not happen. The tree opens *over* the content rather than pushing
 * it, so the two panes that matter never reflow.
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
  const [editingProject, setEditingProject] = useState<string>();
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

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
    <div
      className="relative z-30 shrink-0"
      // Focus opens it too: hover is not available to a keyboard, and the tree is the only way to
      // reach another chat.
      onFocusCapture={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <nav
        aria-label="Projects and chats"
        className="flex h-full w-12 flex-col items-center gap-1 border-border/60 border-r py-3"
      >
        <RailButton label="New chat" onClick={() => onNewChat(activeProjectId)}>
          <SquarePenIcon className="size-4" />
        </RailButton>

        <span aria-hidden className="my-1 h-px w-5 bg-border" />

        {projects.map((project) => (
          <RailButton
            active={project.id === activeProjectId}
            key={project.id}
            // Starts a chat rather than just opening the tree, which hovering already does. Without
            // it nothing is ever selected on load, and the window opens on "pick a project" instead
            // of on the project — the rest state the whole pane was built around.
            label={`New chat in ${project.id}`}
            onClick={() => onNewChat(project.id)}
          >
            <span className="font-medium text-sm uppercase">{project.id[0]}</span>
          </RailButton>
        ))}

        <RailButton className="mt-auto" label="Add a project" onClick={() => setAddingProject(true)}>
          <FolderPlusIcon className="size-4" />
        </RailButton>
      </nav>

      <ProjectPicker onOpenChange={setAddingProject} onPick={onAddProject} open={addingProject} />

      <ProjectSettings
        onOpenChange={(isOpen) => !isOpen && setEditingProject(undefined)}
        onSaved={load}
        project={editingProject}
      />

      <AnimatePresence>
        {open ? (
          <motion.div
            animate={{ opacity: 1, x: 0 }}
            className="absolute inset-y-0 left-12 flex w-64 flex-col border-border border-r bg-card px-2 py-3 shadow-overlay"
            exit={{ opacity: 0, x: reduce ? 0 : -6 }}
            initial={{ opacity: 0, x: reduce ? 0 : -6 }}
            transition={{ duration: reduce ? 0 : 0.16, ease: EASE_OUT }}
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
              <span className="flex-1 font-medium text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground/70">
                Projects
              </span>
              <button
                aria-label="Add a project"
                className="hidden size-5 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:grid group-hover/head:grid"
                onClick={() => setAddingProject(true)}
                type="button"
              >
                <FolderPlusIcon className="size-3.5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {projects.map((project) => {
                const expanded = !collapsed.has(project.id);
                return (
                  <div key={project.id}>
                    <div className="group flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-muted/60">
                      <button
                        aria-expanded={expanded}
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
                            expanded && "rotate-90",
                          )}
                        />
                        <span className="truncate">{project.id}</span>
                      </button>
                      <DesignSystemCard design={project.design} project={project.id} />
                      <button
                        aria-label={`How ${project.id} boots`}
                        className="hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:grid group-hover:grid"
                        onClick={() => setEditingProject(project.id)}
                        type="button"
                      >
                        <Settings2Icon className="size-3.5" />
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

                    {expanded
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
                                onClick={() => {
                                  onOpenChat(chat.sessionId, project.id);
                                  setOpen(false);
                                }}
                                onDoubleClick={() => setRenaming(chat.sessionId)}
                                title={chat.branch}
                                type="button"
                              >
                                {chat.branch === liveBranch ? (
                                  <span
                                    aria-label="showing in the window"
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** A rail control. Square, per the split: the pill is spent on the window's Start. */
function RailButton({
  active,
  children,
  className,
  label,
  onClick,
}: {
  readonly active?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
