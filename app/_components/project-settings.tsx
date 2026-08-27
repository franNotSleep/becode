"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/agent/lib/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Ports live as strings while they are being typed — backspacing one to empty is not NaN. */
type Row = { name: string; command: string; port: string };
type Form = {
  baseBranch: string;
  install: string;
  /** A Linear team key, or "" for none. */
  linearTeam: string;
  apps: Row[];
  services: Row[];
};
type Team = { key: string; name: string };

/** The value of "file these nowhere" — Select has no empty-string item. */
const NO_TEAM = "none";
type Kind = "apps" | "services";

const toForm = (project: Project): Form => ({
  baseBranch: project.baseBranch,
  install: project.install ?? "",
  linearTeam: project.linearTeam ?? "",
  apps: project.apps.map((app) => ({ ...app, port: String(app.port) })),
  services: (project.services ?? []).map((service) => ({
    ...service,
    port: service.port ? String(service.port) : "",
  })),
});

const SECTIONS: Record<Kind, { title: string; hint: string; port: string; command: string }> = {
  apps: {
    title: "Apps",
    hint: "The pages you look at. Write $PORT where the port number goes.",
    port: "3000",
    command: "pnpm dev --port $PORT",
  },
  services: {
    title: "Services",
    hint: "What those pages need running — a database, an API. Shared by every task.",
    port: "optional",
    command: "docker compose up -d",
  },
};

/**
 * Edit a project's boot recipe.
 *
 * The agent works a recipe out once, at `propose_project`, and then can never touch it again:
 * `addProject` throws on a duplicate id and its gate only accepts a folder just picked in the
 * browser. Every correction after that — a dev script that pins its own port, a service that
 * moved, an install command that grew a flag — had nowhere to go. `PATCH /api/projects/[id]`
 * is that place, and this is its form.
 *
 * The command is what a person opens this to change, so it gets a line of its own and wraps
 * rather than scrolling sideways: a recipe you cannot read whole is one you cannot trust. Name
 * and port share the line above it, which is also why nothing here needs a breakpoint.
 *
 * ponytail: no form library. Four fields and two arrays of three, validated by the zod schema the
 * route needs anyway; the route names the row that is wrong and this marks the field.
 */
export function ProjectSettings({
  onOpenChange,
  onSaved,
  project,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void;
  /** The project to edit; `undefined` closes the dialog. */
  readonly project?: string;
}) {
  const [loaded, setLoaded] = useState<{ form: Form; path: string }>();
  const [form, setForm] = useState<Form>();
  const [error, setError] = useState<{ message: string; field?: string }>();
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);

  // Once per dialog open, and separate from the project: Linear being down or unconfigured is
  // not a reason the recipe cannot be edited.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/linear/teams").catch(() => null);
      const body = await response?.json().catch(() => null);
      if (!cancelled && response?.ok) setTeams((body as { teams: Team[] }).teams);
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    if (!project) return;
    setLoaded(undefined);
    setForm(undefined);
    setError(undefined);
    let cancelled = false;

    void (async () => {
      const response = await fetch(`/api/projects/${encodeURIComponent(project)}`).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (cancelled) return;
      if (!response?.ok) {
        setError({ message: (body as { message?: string })?.message ?? "Could not open this project." });
        return;
      }
      const stored = (body as { project: Project }).project;
      setLoaded({ form: toForm(stored), path: stored.path });
      setForm(toForm(stored));
    })();

    return () => {
      cancelled = true;
    };
  }, [project]);

  // Cheap enough on four fields, and the alternative is a dirty flag every setter has to remember.
  const dirty = useMemo(
    () => !!(form && loaded) && JSON.stringify(form) !== JSON.stringify(loaded.form),
    [form, loaded],
  );

  /** A field the route named stops being wrong the moment it is touched. */
  const change = (field: string, next: (previous: Form) => Form) => {
    setError((previous) => (previous?.field === field ? undefined : previous));
    setForm((previous) => previous && next(previous));
  };

  const editRow = (kind: Kind, index: number, patch: Partial<Row>) =>
    change(`${kind}.${index}.${Object.keys(patch)[0]}`, (previous) => ({
      ...previous,
      [kind]: previous[kind].map((row, at) => (at === index ? { ...row, ...patch } : row)),
    }));

  const save = async () => {
    if (!(project && form)) return;
    setSaving(true);
    setError(undefined);

    const response = await fetch(`/api/projects/${encodeURIComponent(project)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseBranch: form.baseBranch,
        install: form.install,
        linearTeam: form.linearTeam,
        apps: form.apps.map((app) => ({ ...app, port: Number(app.port) })),
        // A service binds whatever its own env says; the port is only declared so the port gate
        // can notice a stale one squatting there, and plenty of services have none to declare.
        services: form.services.map((service) => ({
          name: service.name,
          command: service.command,
          ...(service.port.trim() ? { port: Number(service.port) } : {}),
        })),
      }),
    }).catch(() => null);

    setSaving(false);
    const body = (await response?.json().catch(() => null)) as
      | { message?: string; field?: string }
      | null;
    if (!response?.ok) {
      setError({ message: body?.message ?? "Could not save this.", field: body?.field });
      return;
    }
    onOpenChange(false);
    onSaved();
  };

  const section = (kind: Kind) => {
    if (!form) return null;
    const copy = SECTIONS[kind];
    const locked = kind === "apps" && form[kind].length === 1;

    return (
      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <h3 className="font-medium text-sm">{copy.title}</h3>
            <p className="text-muted-foreground text-xs leading-relaxed">{copy.hint}</p>
          </div>
          <Button
            onClick={() =>
              change(kind, (previous) => ({
                ...previous,
                [kind]: [...previous[kind], { name: "", command: "", port: "" }],
              }))
            }
            size="xs"
            type="button"
            variant="ghost"
          >
            <PlusIcon />
            add
          </Button>
        </div>

        <div className="space-y-4">
          {form[kind].map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and have no id.
            <div className="space-y-1.5" key={index}>
              <div className="flex items-center gap-2">
                <Input
                  aria-invalid={error?.field === `${kind}.${index}.name`}
                  aria-label={`${copy.title} name`}
                  className="h-8 flex-1 text-sm"
                  onChange={(event) => editRow(kind, index, { name: event.target.value })}
                  placeholder={kind === "apps" ? "storefront" : "database"}
                  value={row.name}
                />
                <InputGroup
                  className={cn(
                    "h-8 w-28 shrink-0",
                    // InputGroup ships its own `has-[…aria-invalid…]` error style and Tailwind
                    // never compiles the rule — verified in the running stylesheet. The state is
                    // already here; mark it from here rather than from a selector that is absent.
                    error?.field === `${kind}.${index}.port` &&
                      "border-destructive ring-[3px] ring-destructive/20 dark:ring-destructive/40",
                  )}
                >
                  <InputGroupAddon className="pl-2.5 font-mono text-xs">:</InputGroupAddon>
                  <InputGroupInput
                    aria-invalid={error?.field === `${kind}.${index}.port`}
                    aria-label={`${row.name || copy.title} port`}
                    className="font-mono text-xs"
                    inputMode="numeric"
                    onChange={(event) => editRow(kind, index, { port: event.target.value })}
                    placeholder={copy.port}
                    value={row.port}
                  />
                </InputGroup>
                <Button
                  aria-label={`Remove ${row.name || copy.title.toLowerCase()}`}
                  disabled={locked}
                  onClick={() =>
                    change(kind, (previous) => ({
                      ...previous,
                      [kind]: previous[kind].filter((_, at) => at !== index),
                    }))
                  }
                  size="icon-sm"
                  title={locked ? "becode needs at least one app to show you" : undefined}
                  type="button"
                  variant="ghost"
                >
                  <XIcon />
                </Button>
              </div>
              <Textarea
                aria-invalid={error?.field === `${kind}.${index}.command`}
                aria-label={`${row.name || copy.title} command`}
                className="min-h-0 resize-none px-3 py-1.5 font-mono text-xs leading-relaxed"
                onChange={(event) => editRow(kind, index, { command: event.target.value })}
                placeholder={copy.command}
                rows={1}
                value={row.command}
              />
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={!!project}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-xl"
        // Escape still closes — that is deliberate. A stray click on the page is not, and typed
        // commands are the one thing here nobody wants to retype.
        onInteractOutside={(event) => dirty && event.preventDefault()}
      >
        <DialogHeader className="space-y-1 border-b p-6 pb-4">
          <DialogTitle>{project}</DialogTitle>
          <DialogDescription>
            How becode starts this project so you can look at it. Changes apply the next time it
            starts.
          </DialogDescription>
          {loaded ? (
            <p className="truncate pt-1 font-mono text-[0.6875rem] text-muted-foreground/70">
              {loaded.path.replace(/^\/Users\/[^/]+/, "~")}
            </p>
          ) : null}
        </DialogHeader>

        {form ? (
          <div className="flex-1 space-y-7 overflow-y-auto p-6">
            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground text-xs">Branch</span>
                <Input
                  aria-invalid={error?.field === "baseBranch"}
                  className="h-8 flex-1 font-mono text-xs"
                  onChange={(event) =>
                    change("baseBranch", (previous) => ({
                      ...previous,
                      baseBranch: event.target.value,
                    }))
                  }
                  value={form.baseBranch}
                />
              </label>
              <p className="pl-27 text-muted-foreground text-xs leading-relaxed">
                Work starts from this branch, and every pull request goes back to it.
              </p>
              <label className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground text-xs">Install</span>
                <Input
                  className="h-8 flex-1 font-mono text-xs"
                  onChange={(event) =>
                    change("install", (previous) => ({ ...previous, install: event.target.value }))
                  }
                  placeholder="run once before the first start — optional"
                  value={form.install}
                />
              </label>
              {teams.length ? (
                <>
                  <label className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 text-muted-foreground text-xs">Linear</span>
                    <Select
                      onValueChange={(value) =>
                        change("linearTeam", (previous) => ({
                          ...previous,
                          linearTeam: value === NO_TEAM ? "" : value,
                        }))
                      }
                      value={form.linearTeam || NO_TEAM}
                    >
                      <SelectTrigger className="h-8 flex-1 text-xs" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_TEAM}>Not chosen</SelectItem>
                        {teams.map((team) => (
                          <SelectItem key={team.key} value={team.key}>
                            {team.name} <span className="font-mono text-xs">({team.key})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <p className="pl-27 text-muted-foreground text-xs leading-relaxed">
                    The team every pull request from this project is filed under. Its issue
                    identifier goes in the branch name, which is what links the two. Without one,
                    pull requests still open — untracked.
                  </p>
                </>
              ) : null}
            </div>

            {section("apps")}
            {section("services")}
          </div>
        ) : (
          <p className="grid min-h-40 place-items-center p-6 text-center text-muted-foreground text-sm">
            {error?.message ?? "Opening…"}
          </p>
        )}

        {form ? (
          <DialogFooter className="items-center gap-3 border-t p-6 py-4 sm:justify-between">
            <p
              className={
                error ? "text-destructive text-sm" : "text-muted-foreground text-xs sm:text-sm"
              }
            >
              {error?.message ?? (dirty ? "Unsaved changes" : "")}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
                {dirty ? "Discard" : "Close"}
              </Button>
              <Button disabled={!dirty || saving} onClick={() => void save()} type="button">
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
