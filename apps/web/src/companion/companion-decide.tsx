import type { QuestionChoice, ThreadId } from "@gram/contracts";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { answersInFull } from "@/inbox/inbox-detail";
import { cn } from "@/lib/utils";
import { replyAction, type AskOption } from "@/orchestration/ask-model";
import type { NeedsYouItem } from "@/orchestration/needs-you-items";
import { useNeedsYouActions } from "@/orchestration/needs-you-row";
import { imageDataUrl, useCheckoutImage } from "@/panels/files/image-preview";

import { ResizeGrip, sizedStyle } from "./companion-resize";
import { useCompanion } from "./companion-store";

const KIND_WORD: Record<NeedsYouItem["kind"], string> = {
  approval: "Approval",
  question: "Question",
  plan: "Plan to review",
  wait: "Waiting on you",
  failure: "Failed",
  watch: "Stopped watch",
};

const close = () => useCompanion.getState().showSheet(undefined);

/**
 * What waits on the person, one decision at a time, in place of the chat: the question in large
 * type with its context, its options as tiles (with their pictures), a typed answer, or an
 * approval's command with its verbs. Several step through as "1 of 3"; answering the last goes back
 * to the chat. Every answer goes through the Inbox's own actions, so it clears everywhere.
 */
export function Decide({
  needs,
  start,
  onOpen,
}: {
  needs: readonly NeedsYouItem[];
  start: string | undefined;
  onOpen: (threadId?: ThreadId) => void;
}) {
  const sheetSize = useCompanion((s) => s.sizes.sheet);
  const [at, setAt] = useState(() =>
    Math.max(
      0,
      needs.findIndex((item) => item.key === start),
    ),
  );
  const index = Math.min(at, needs.length - 1);
  const item = needs[index];
  if (item === undefined) return null;
  const answered = () => {
    if (needs.length === 1) close();
  };
  return (
    <section
      data-testid="companion-decide"
      data-kind={item.kind}
      aria-label={`${KIND_WORD[item.kind]}: ${item.title}`}
      style={sizedStyle(sheetSize)}
      className="companion-glass companion-sheet relative flex max-h-[min(42rem,calc(100dvh-6rem))] w-[min(34rem,calc(100vw-2rem))] flex-col"
    >
      <ResizeGrip surface="sheet" />
      <header className="flex min-w-0 items-center gap-2 border-b border-edge px-3 py-2">
        <Button size="icon-sm" variant="ghost" aria-label="Back to the chat" onClick={close}>
          <ArrowLeft />
        </Button>
        <span className="min-w-0 flex-1 truncate text-meta text-status-needs">
          {KIND_WORD[item.kind]} · {item.where}
        </span>
        {needs.length > 1 && (
          <span className="flex items-center gap-1 text-meta text-muted-foreground">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous"
              disabled={index === 0}
              onClick={() => setAt(index - 1)}
            >
              <ChevronLeft />
            </Button>
            <span data-testid="companion-decide-position" className="font-mono">
              {index + 1} of {needs.length}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next"
              disabled={index === needs.length - 1}
              onClick={() => setAt(index + 1)}
            >
              <ChevronRight />
            </Button>
          </span>
        )}
      </header>
      <div
        key={item.key}
        className="companion-decide-body min-h-0 flex-1 overflow-y-auto px-6 py-5"
      >
        <Decision item={item} onOpen={onOpen} onAnswered={answered} />
      </div>
    </section>
  );
}

function Decision({
  item,
  onOpen,
  onAnswered,
}: {
  item: NeedsYouItem;
  onOpen: (threadId?: ThreadId) => void;
  onAnswered: () => void;
}) {
  const base = useNeedsYouActions();
  const actions = {
    answer: (each: NeedsYouItem, option: AskOption) => {
      base.answer(each, option);
      onAnswered();
    },
    done: (each: NeedsYouItem) => {
      base.done(each);
      onAnswered();
    },
    dismissWait: (each: NeedsYouItem, note: string | undefined) => {
      base.dismissWait(each, note);
      onAnswered();
    },
  };
  const ask = item.ask;
  const inPlace = ask !== undefined && !answersInFull(ask);
  const options = inPlace
    ? ask.options.filter((o) => o.action.kind !== "open" && o.action.kind !== "board")
    : [];
  const pictures = new Map(
    (ask?.visuals?.options ?? []).map((choice) => [choice.label, choice] as const),
  );
  const approval = ask?.icon === "approval";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 data-testid="companion-decide-title" className="font-heading text-title text-pretty">
          {approval && item.command !== undefined ? (
            "Run this command?"
          ) : (
            <WithCode text={ask?.lead ?? item.title} />
          )}
        </h2>
        {ask?.context !== undefined && ask.context !== "" && (
          <p className="text-meta text-subtle">{ask.context}</p>
        )}
        {ask?.description !== undefined && (
          <p className="text-reading leading-relaxed text-muted-foreground">
            <WithCode text={ask.description} />
          </p>
        )}
      </div>
      {item.command !== undefined && (
        <pre className="companion-inset max-h-56 overflow-auto rounded-xl px-3.5 py-3 font-mono text-meta leading-relaxed whitespace-pre-wrap break-all">
          {item.command}
        </pre>
      )}
      {ask !== undefined && ask.extras.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
          {ask.extras.map((field) => (
            <div key={field.label} className="contents">
              <dt className="text-subtle">{field.label}</dt>
              <dd className="min-w-0 font-mono break-all">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {approval ? (
        <div className="flex flex-wrap gap-2">
          {options.map((option, index) => (
            <Button
              key={option.label}
              data-testid="companion-decide-option"
              variant={
                index === 0
                  ? "default"
                  : option.action.kind === "group" && option.action.decision === "deny"
                    ? "destructive"
                    : "outline"
              }
              onClick={() => actions.answer(item, option)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      ) : (
        options.length > 0 && (
          <div
            className={cn(
              "grid gap-2.5",
              options.length > 1 && options.every((o) => o.label.length < 28) && "sm:grid-cols-2",
            )}
          >
            {options.map((option) => (
              <OptionTile
                key={option.label}
                option={option}
                picture={pictures.get(option.label)}
                threadId={ask?.visuals?.threadId}
                onPick={() => actions.answer(item, option)}
              />
            ))}
          </div>
        )
      )}
      {inPlace && (ask.freeForm !== undefined || ask.other !== undefined) && (
        <Words item={item} onSend={actions.answer} />
      )}
      {item.wait !== undefined && (
        <div className="flex flex-wrap gap-2">
          <Button data-testid="companion-decide-option" onClick={() => actions.done(item)}>
            Done
          </Button>
          <Button variant="outline" onClick={() => actions.dismissWait(item, undefined)}>
            Dismiss
          </Button>
        </div>
      )}
      {item.threadId !== undefined && (
        <Button variant="link" className="self-start px-0" onClick={() => onOpen(item.threadId)}>
          <ExternalLink />
          Open in Gram
        </Button>
      )}
    </div>
  );
}

function OptionTile({
  option,
  picture,
  threadId,
  onPick,
}: {
  option: AskOption;
  picture: QuestionChoice | undefined;
  threadId: ThreadId | undefined;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="companion-decide-option"
      data-recommended={option.recommended === true || undefined}
      onClick={onPick}
      className={cn(
        "companion-inset flex flex-col gap-1.5 rounded-xl p-3 text-left outline-none hover:bg-surface-2 focus-visible:focus-ring",
        option.recommended === true && "ring-1 ring-primary",
      )}
    >
      {picture?.image !== undefined && threadId !== undefined && (
        <Picture threadId={threadId} path={picture.image} label={option.label} />
      )}
      <span className="flex items-center justify-between gap-2">
        <span className="text-body-strong">{option.label}</span>
        {option.recommended === true && (
          <span className="shrink-0 text-meta text-link">Recommended</span>
        )}
      </span>
      {option.description !== undefined && (
        <span className="text-meta text-muted-foreground">{option.description}</span>
      )}
    </button>
  );
}

function Picture({ threadId, path, label }: { threadId: ThreadId; path: string; label: string }) {
  const image = useCheckoutImage(threadId, path);
  const src = imageDataUrl(image.data);
  return (
    <span className="block overflow-hidden rounded-lg border border-edge bg-surface-1">
      {src === undefined ? (
        <span className="grid aspect-video place-items-center text-meta text-subtle">
          {image.isPending ? "Loading…" : "No picture"}
        </span>
      ) : (
        <img src={src} alt={label} className="block w-full" />
      )}
    </span>
  );
}

function Words({
  item,
  onSend,
}: {
  item: NeedsYouItem;
  onSend: (item: NeedsYouItem, option: AskOption) => void;
}) {
  const [text, setText] = useState("");
  const ask = item.ask!;
  const send = (event: FormEvent) => {
    event.preventDefault();
    const action = replyAction(ask, text.trim());
    if (action === undefined || text.trim() === "") return;
    onSend(item, { label: "Reply", done: "Answered", action });
    setText("");
  };
  return (
    <form onSubmit={send} className="flex flex-col gap-2">
      <label className="text-meta text-subtle" htmlFor={`decide-${item.key}`}>
        {ask.freeForm === undefined ? "Or in your own words" : "Your answer"}
      </label>
      <textarea
        id={`decide-${item.key}`}
        data-testid="companion-decide-words"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="companion-inset resize-none rounded-xl px-3 py-2 text-body outline-none"
      />
      <Button
        type="submit"
        variant={text.trim() === "" ? "outline" : "default"}
        className="self-end"
        disabled={text.trim() === ""}
      >
        Send answer
      </Button>
    </form>
  );
}

function WithCode({ text }: { text: string }) {
  return text.split("`").map((part, index) =>
    index % 2 === 1 && index < text.split("`").length - 1 ? (
      <code key={index} className="rounded-sm bg-surface-2 px-1 font-mono">
        {part}
      </code>
    ) : (
      <span key={index}>{index % 2 === 1 ? `\`${part}` : part}</span>
    ),
  );
}
