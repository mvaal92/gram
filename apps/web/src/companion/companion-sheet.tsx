import type { MockDirection, QuestionChoice, ThreadId } from "@gram/contracts";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { useApi } from "@/api/context";
import { Markdown } from "@/components/ai-elements/markdown";
import { Button } from "@/components/ui/button";
import { useDoc } from "@/docs/doc-queries";
import { useThreadFeed } from "@/stores/feeds";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { imageDataUrl, useCheckoutImage } from "@/panels/files/image-preview";

import { PictureImage } from "./companion-cards";
import { lastExchange, type CompanionTask } from "./companion-model";
import { ResizeGrip, sizedStyle } from "./companion-resize";
import { useCompanion, type CompanionSheet } from "./companion-store";

const close = () => useCompanion.getState().showSheet(undefined);

/**
 * The sheet grown out of the companion's corner in place of its dropdown: a doc to read at a
 * comfortable width, a mock's directions to look at and pick, a question's pictures, or where a
 * task stands. Back returns to the chat; only Open in Gram hands over to the full app.
 */
export function Sheet({
  sheet,
  talkTo,
  tasks,
  onOpen,
}: {
  sheet: Exclude<CompanionSheet, { kind: "decide" }>;
  /** The thread a pick is sent to: the orchestrator the companion talks to. */
  talkTo: ThreadId | undefined;
  /** The work the companion follows, so a task's sheet shows where it stands now. */
  tasks: readonly CompanionTask[];
  onOpen: (threadId?: ThreadId) => void;
}) {
  const pick = usePick();
  const sheetSize = useCompanion((s) => s.sizes.sheet);
  const title = sheet.kind === "mock" ? sheet.mock.title : sheet.title;
  const openIn = sheet.kind === "doc" ? undefined : sheet.threadId;
  return (
    <section
      data-testid="companion-sheet"
      data-kind={sheet.kind}
      aria-label={title}
      style={sizedStyle(sheetSize)}
      className="companion-glass companion-sheet relative flex max-h-[min(42rem,calc(100dvh-6rem))] w-[min(34rem,calc(100vw-2rem))] flex-col"
    >
      <ResizeGrip surface="sheet" />
      <header className="flex min-w-0 items-center gap-2 border-b border-edge px-3 py-2">
        <Button size="icon-sm" variant="ghost" aria-label="Back to the chat" onClick={close}>
          <ArrowLeft />
        </Button>
        <h2 className="min-w-0 flex-1 truncate font-heading text-body font-semibold">{title}</h2>
        {openIn !== undefined && (
          <Button size="xs" variant="ghost" onClick={() => onOpen(openIn)}>
            <ExternalLink />
            Open in Gram
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {sheet.kind === "doc" ? (
          <DocReader sheet={sheet} />
        ) : sheet.kind === "mock" ? (
          <MockSheet
            threadId={sheet.threadId}
            directions={sheet.mock.directions}
            meta={[
              sheet.mock.version === undefined ? undefined : `v${sheet.mock.version}`,
              sheet.mock.status,
            ]}
            onPick={(name) =>
              pick(talkTo, `Go with the "${name}" direction of the ${sheet.mock.title} mock.`)
            }
          />
        ) : sheet.kind === "picture" ? (
          <div data-testid="companion-picture" className="p-4">
            <PictureImage threadId={sheet.threadId} picture={sheet.picture} alt={sheet.title} />
          </div>
        ) : sheet.kind === "task" ? (
          <TaskSheet
            threadId={sheet.threadId}
            task={tasks.find((each) => each.id === sheet.threadId)}
          />
        ) : (
          <Choices threadId={sheet.threadId} options={sheet.options} />
        )}
      </div>
    </section>
  );
}

function usePick() {
  const api = useApi();
  return (threadId: ThreadId | undefined, text: string) => {
    if (threadId === undefined) return;
    void api.send(threadId, { text }).then(
      () => useCompanion.getState().showSheet(undefined),
      (error: unknown) => console.error("companion: pick", error),
    );
  };
}

function DocReader({ sheet }: { sheet: Extract<CompanionSheet, { kind: "doc" }> }) {
  const doc = useDoc(sheet.workspaceId, sheet.id);
  if (doc.isPending) return <p className="p-5 text-meta text-muted-foreground">Loading…</p>;
  if (doc.data === undefined)
    return <p className="p-5 text-meta text-muted-foreground">This doc couldn't be opened.</p>;
  return (
    <article
      data-testid="companion-doc"
      className="companion-reader mx-auto max-w-[62ch] px-6 py-5"
    >
      <p className="mb-3 text-meta text-subtle">
        {doc.data.authorTitle} · revision {doc.data.revision} · {formatStamp(doc.data.updatedAt)}
      </p>
      <Markdown mode="static">{doc.data.content}</Markdown>
    </article>
  );
}

const PHASE_WORDS: Record<CompanionTask["phase"], string> = {
  doing: "Working",
  needs: "Asks you",
  done: "Done",
  failed: "Failed",
};

function TaskSheet({ threadId, task }: { threadId: ThreadId; task: CompanionTask | undefined }) {
  const reply = useThreadFeed(threadId, (s) => lastExchange(s.messages).reply);
  const phase =
    task === undefined
      ? undefined
      : task.blocked === true
        ? "Blocked"
        : `${PHASE_WORDS[task.phase]}${task.progress === undefined ? "" : ` · ${task.progress}`}`;
  return (
    <article
      data-testid="companion-task-sheet"
      className="companion-reader flex flex-col gap-3 px-5 py-4"
    >
      {phase !== undefined && (
        <p className="text-meta text-muted-foreground">
          {phase}
          {task?.line === undefined ? "" : ` · ${task.line}`}
        </p>
      )}
      {reply === undefined ? (
        <p className="text-meta text-muted-foreground">No update from it yet.</p>
      ) : (
        <Markdown mode="static">{reply}</Markdown>
      )}
    </article>
  );
}

function MockSheet({
  threadId,
  directions,
  meta,
  onPick,
}: {
  threadId: ThreadId;
  directions: readonly MockDirection[];
  meta: readonly (string | undefined)[];
  onPick: (name: string) => void;
}) {
  const line = meta.filter((each) => each !== undefined).join(" · ");
  return (
    <div data-testid="companion-mock" className="flex flex-col gap-4 p-4">
      {line !== "" && <p className="text-meta text-subtle">{line}</p>}
      {directions.length === 0 && (
        <p className="text-meta text-muted-foreground">
          No screenshots yet. Open it in Gram to see the page itself.
        </p>
      )}
      {directions.map((direction) => (
        <figure key={direction.name} className="flex flex-col gap-2">
          <Shot
            threadId={threadId}
            path={direction.shots.dark ?? direction.shots.light}
            label={direction.name}
          />
          <figcaption className="flex items-center justify-between gap-2 text-meta">
            <span className="truncate font-semibold">{direction.name}</span>
            {directions.length > 1 && (
              <Button size="xs" variant="outline" onClick={() => onPick(direction.name)}>
                Pick this
              </Button>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function Choices({
  threadId,
  options,
}: {
  threadId: ThreadId;
  options: readonly QuestionChoice[];
}) {
  return (
    <div data-testid="companion-choices" className="flex flex-col gap-4 p-4">
      {options.map((option) => (
        <figure key={option.label} className="flex flex-col gap-1.5">
          {option.image !== undefined && (
            <Shot threadId={threadId} path={option.image} label={option.label} />
          )}
          <figcaption className="text-meta">
            <span className="font-semibold">{option.label}</span>
            {option.description !== undefined && (
              <span className="text-muted-foreground"> · {option.description}</span>
            )}
          </figcaption>
        </figure>
      ))}
      <p className="text-meta text-subtle">Answer it from the companion's list or in Gram.</p>
    </div>
  );
}

function Shot({
  threadId,
  path,
  label,
}: {
  threadId: ThreadId;
  path: string | undefined;
  label: string;
}) {
  const image = useCheckoutImage(threadId, path ?? "", path !== undefined);
  const src = imageDataUrl(image.data);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-edge bg-surface-1",
        src === undefined && "grid aspect-video place-items-center",
      )}
    >
      {src === undefined ? (
        <span className="text-meta text-subtle">{image.isPending ? "Loading…" : "No picture"}</span>
      ) : (
        <img src={src} alt={label} className="block w-full" />
      )}
    </div>
  );
}
