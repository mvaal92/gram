import type { ThreadId } from "@gram/contracts";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { answersInFull } from "@/inbox/inbox-detail";
import { replyAction } from "@/orchestration/ask-model";
import type { NeedsYouItem } from "@/orchestration/needs-you-items";
import { useNeedsYouActions } from "@/orchestration/needs-you-row";
import { StatusDot } from "@/orchestration/status-dot";

import { useCompanion } from "./companion-store";

/**
 * One item of Waiting on you, answered where it stands: an ask's options or its words, a wait's
 * Done or Dismiss, a question's pictures in the sheet, else Open in Gram. Every answer goes through
 * the Inbox's own actions, so it clears everywhere at once.
 */
export function InboxCard({
  item,
  onOpen,
}: {
  item: NeedsYouItem;
  onOpen: (threadId?: ThreadId) => void;
}) {
  const actions = useNeedsYouActions();
  const show = useCompanion((s) => s.showSheet);
  const ask = item.ask;
  const inPlace = ask !== undefined && !answersInFull(ask);
  const options = inPlace
    ? ask.options.filter((o) => o.action.kind !== "open" && o.action.kind !== "board")
    : [];
  const words = inPlace && (ask.freeForm !== undefined || ask.other !== undefined);
  const pictures = ask?.visuals?.options.some((o) => o.image !== undefined) === true;
  return (
    <div
      role="group"
      aria-label={item.title}
      data-testid="companion-needs"
      data-kind={item.kind}
      className="companion-inset flex flex-col gap-1.5 rounded-xl px-2.5 py-2 text-meta"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-1.5">
          <StatusDot state={item.kind === "failure" ? "error" : "needs"} className="mt-1" />
          <strong className="line-clamp-2 font-semibold">{item.title}</strong>
        </span>
        <span className="max-w-24 shrink-0 truncate text-subtle">{item.where}</span>
      </div>
      {item.command !== undefined && (
        <code className="line-clamp-3 font-mono text-meta break-all">{item.command}</code>
      )}
      {ask?.description !== undefined && inPlace && (
        <p className="line-clamp-3 text-muted-foreground">{ask.description}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((option, index) => (
          <Button
            key={option.label}
            size="xs"
            data-testid="companion-answer"
            variant={
              option.recommended === true || (index === 0 && ask?.icon === "approval")
                ? "default"
                : "outline"
            }
            title={option.description}
            onClick={() => actions.answer(item, option)}
          >
            {option.label}
          </Button>
        ))}
        {item.wait !== undefined && (
          <>
            <Button size="xs" variant="outline" onClick={() => actions.done(item)}>
              Done
            </Button>
            <Button size="xs" variant="ghost" onClick={() => actions.dismissWait(item, undefined)}>
              Dismiss
            </Button>
          </>
        )}
        {pictures && ask?.visuals !== undefined && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              show({
                kind: "choices",
                threadId: ask.visuals!.threadId,
                title: item.title,
                askKey: ask.key,
                options: ask.visuals!.options,
              })
            }
          >
            See options
          </Button>
        )}
        {item.threadId !== undefined && (
          <Button size="xs" variant="link" onClick={() => onOpen(item.threadId)}>
            Open in Gram
          </Button>
        )}
      </div>
      {words && <Reply item={item} />}
    </div>
  );
}

function Reply({ item }: { item: NeedsYouItem }) {
  const actions = useNeedsYouActions();
  const [text, setText] = useState("");
  const ask = item.ask!;
  const send = (event: FormEvent) => {
    event.preventDefault();
    const action = replyAction(ask, text.trim());
    if (action === undefined || text.trim() === "") return;
    actions.answer(item, { label: "Reply", done: "Answered", action });
    setText("");
  };
  return (
    <form onSubmit={send} className="flex items-center gap-1.5">
      <input
        aria-label={`Answer: ${item.title}`}
        data-testid="companion-reply-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={ask.freeForm === undefined ? "Other…" : "Answer…"}
        className="companion-inset min-w-0 flex-1 rounded-md px-2 py-1 text-meta outline-none placeholder:text-subtle"
      />
      <Button type="submit" size="xs" disabled={text.trim() === ""}>
        Send
      </Button>
    </form>
  );
}
