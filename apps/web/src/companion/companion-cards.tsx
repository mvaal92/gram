import type { DocCardData, GramUIMessage, MockCardData, ThreadId } from "@gram/contracts";
import { FileText, Globe, LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";

import { imageDataUrl, useCheckoutImage } from "@/panels/files/image-preview";
import { isToolPart, toolNameOf } from "@/thread/parts";

import { useCompanion } from "./companion-store";

/** What a message shares that the chat shows as a card: a mock, a doc, or a preview started. */
export type Shared =
  | { readonly kind: "mock"; readonly mock: MockCardData }
  | { readonly kind: "doc"; readonly doc: DocCardData }
  | { readonly kind: "preview"; readonly url: string };

const urlIn = (value: unknown): string | undefined => {
  if (typeof value === "string") return /^https?:\/\//u.test(value) ? value : undefined;
  if (value === null || typeof value !== "object") return undefined;
  const record = value as { url?: unknown; content?: unknown };
  if (typeof record.url === "string") return record.url;
  if (Array.isArray(record.content)) {
    for (const item of record.content as unknown[]) {
      const text =
        item !== null && typeof item === "object" && "text" in item ? item.text : undefined;
      const found = typeof text === "string" ? /https?:\/\/\S+/u.exec(text)?.[0] : undefined;
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

/** The cards one message carries, in order: `show_mock`, `publish_doc` and a started preview. */
export function sharedIn(message: GramUIMessage): readonly Shared[] {
  return message.parts.flatMap((part): Shared[] => {
    if (part.type === "data-mock") return [{ kind: "mock", mock: part.data }];
    if (part.type === "data-doc") return [{ kind: "doc", doc: part.data }];
    if (
      isToolPart(part) &&
      toolNameOf(part).endsWith("preview_start") &&
      part.state === "output-available"
    ) {
      const url = urlIn(part.output);
      return url === undefined ? [] : [{ kind: "preview", url }];
    }
    return [];
  });
}

/** One shared thing as a compact card in the chat; opening it grows the sheet, or hands to Gram. */
export function SharedCard({
  threadId,
  shared,
  onOpen,
}: {
  threadId: ThreadId;
  shared: Shared;
  onOpen: (threadId?: ThreadId) => void;
}) {
  const show = useCompanion((s) => s.showSheet);
  switch (shared.kind) {
    case "mock":
      return (
        <Card
          kind="mock"
          thumb={<MockThumbnail threadId={threadId} mock={shared.mock} />}
          title={shared.mock.title}
          meta={[
            "Mock",
            shared.mock.version === undefined ? undefined : `v${shared.mock.version}`,
            `${shared.mock.directions.length} direction${shared.mock.directions.length === 1 ? "" : "s"}`,
          ]}
          action="View"
          onAction={() => show({ kind: "mock", threadId, mock: shared.mock })}
        />
      );
    case "doc":
      return (
        <Card
          kind="doc"
          thumb={<FileText aria-hidden className="size-5 text-muted-foreground" />}
          title={shared.doc.title}
          meta={["Doc", shared.doc.excerpt]}
          action="Read"
          onAction={() =>
            show({
              kind: "doc",
              workspaceId: shared.doc.workspaceId,
              id: shared.doc.id,
              title: shared.doc.title,
            })
          }
        />
      );
    case "preview":
      return (
        <Card
          kind="preview"
          thumb={<Globe aria-hidden className="size-5 text-muted-foreground" />}
          title={shared.url.replace(/^https?:\/\//u, "")}
          meta={["Preview"]}
          action="Open in Gram"
          onAction={() => onOpen(threadId)}
        />
      );
  }
}

function Card({
  kind,
  thumb,
  title,
  meta,
  action,
  onAction,
}: {
  kind: Shared["kind"];
  thumb: ReactNode;
  title: string;
  meta: readonly (string | undefined)[];
  action: string;
  onAction: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="companion-card"
      data-kind={kind}
      onClick={onAction}
      className="companion-inset flex w-full min-w-0 items-center gap-2.5 rounded-xl p-1.5 pr-2.5 text-left hover:bg-surface-2"
    >
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-1">
        {thumb}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-meta font-semibold">{title}</span>
        <span className="truncate text-meta text-subtle">
          {meta.filter((each) => each !== undefined && each !== "").join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-meta text-link">{action}</span>
    </button>
  );
}

function MockThumbnail({ threadId, mock }: { threadId: ThreadId; mock: MockCardData }) {
  const first = mock.directions[0]?.shots;
  const path = first?.dark ?? first?.light;
  const image = useCheckoutImage(threadId, path ?? "", path !== undefined);
  const src = imageDataUrl(image.data);
  return src === undefined ? (
    <LayoutDashboard aria-hidden className="size-5 text-muted-foreground" />
  ) : (
    <img src={src} alt="" className="size-full object-cover" />
  );
}
