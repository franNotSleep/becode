import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allProjects, findProject } from "@/agent/lib/db.ts";
import { git } from "@/agent/lib/git.ts";
import { designDocs, projectDesign } from "@/agent/lib/impeccable.ts";
import { DesignSystemView } from "@/app/_components/design-system-view";

// Reads the target checkout off the local filesystem.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A project's design system, drawn in its own design language.
 *
 * A server component rather than a route plus a fetch: the files are on this machine and the page
 * is the only reader. `generateStaticParams` would be wrong here — a repo's design context changes
 * whenever someone commits to it, and becode is a local process with no cache to invalidate.
 *
 * Everything below the chrome is painted with the project's own tokens, so the person is reading
 * tix's design system in tix's design language rather than a description of it. That is the whole
 * point: becode's promise is that a change will match the product, and this is the evidence.
 */
export default async function DesignPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project: id } = await params;
  if (!allProjects().some((p) => p.id === id)) notFound();

  const project = findProject(id);
  const design = await projectDesign(project.path, (paths) =>
    git(project.path, "ls-files", "--", ...paths).then((out) => out.split("\n").filter(Boolean)),
  );
  const docs = designDocs(project.path);
  const families = fontFamilies(design.system);

  return (
    <>
      {families.length > 0 ? (
        // React hoists this into <head>. A family that is not on Google Fonts simply 404s and the
        // stack below it in `fontFamily` takes over — the specimen degrades, the page does not.
        <link
          href={`https://fonts.googleapis.com/css2?${families
            .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@300;400;500;600;700`)
            .join("&")}&display=swap`}
          rel="stylesheet"
        />
      ) : null}

      <div className="flex h-dvh flex-col bg-background">
        <header className="flex shrink-0 items-center gap-3 border-border/60 border-b px-4 py-2.5">
          <Link
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
            href="/"
          >
            <ArrowLeftIcon className="size-3.5" />
            Chats
          </Link>
          <span className="text-border">/</span>
          <span className="text-sm">{id}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {docs.length > 0 ? docs.map((doc) => doc.path).join(" · ") : "no design context"}
          </span>
        </header>

        <DesignSystemView design={design} docs={docs} project={id} />
      </div>
    </>
  );
}

/** Every distinct first-choice family the type roles ask for, deduped, for one stylesheet request. */
function fontFamilies(system: Awaited<ReturnType<typeof projectDesign>>["system"]): string[] {
  const names = (system?.type ?? [])
    .map((role) => role.family?.split(",")[0].trim().replace(/^["']|["']$/g, ""))
    .filter((name): name is string => !!name && !GENERIC.has(name.toLowerCase()));
  return [...new Set(names)];
}

/** CSS generic families are not fonts to fetch. */
const GENERIC = new Set([
  "cursive",
  "fantasy",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-sans-serif",
  "ui-serif",
]);
