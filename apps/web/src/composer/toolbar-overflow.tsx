import { Menu } from "@base-ui/react/menu";
import {
  AtSign,
  CheckIcon,
  ChevronRightIcon,
  Ellipsis,
  Paperclip,
  Plus,
  Send,
  Square,
  Terminal,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PickerOption } from "./picker";
import { ROUND } from "./styles";

const POPUP =
  "z-50 min-w-52 origin-(--transform-origin) rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none transition-[opacity,scale] duration-(--dur-fast) data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0";
const ITEM =
  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-3.5 [&_svg]:shrink-0";

/** A picker that no longer fits on the toolbar, offered in the "…" menu as a submenu. */
export interface FoldedPicker {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly value: string | undefined;
  readonly options: readonly (PickerOption<string> & { readonly disabled?: boolean })[];
  readonly onChange: (value: string) => void;
  readonly warning?: string | undefined;
  readonly description?: string | undefined;
}

export interface ComposerQuickActions {
  readonly onAttach: () => void;
  readonly onCommands: () => void;
  readonly onMention: () => void;
  readonly onStop?: (() => void) | undefined;
}

/**
 * The composer toolbar's "…" (or "+" on mobile): the pickers and Steer that folded away when it
 * got narrow. A folded picker's shortcut opens this menu at its submenu, which `openSub` names.
 */
export function ToolbarOverflow({
  pickers,
  steer,
  plus = false,
  actions,
  open,
  onOpenChange,
  openSub,
  onOpenSubChange,
}: {
  pickers: readonly FoldedPicker[];
  /** Steer now, when it folded and a turn is running; `disabled` with nothing to steer. */
  steer?: { run: () => void; disabled: boolean; label: string } | undefined;
  /** Mobile composer mode: renders a circular "+" button and includes attachment/command actions. */
  plus?: boolean | undefined;
  actions?: ComposerQuickActions | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openSub: string | undefined;
  onOpenSubChange: (id: string | undefined) => void;
}) {
  return (
    <Menu.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Menu.Trigger
        data-testid={plus ? "composer-plus" : "composer-overflow"}
        render={
          plus ? (
            <button
              type="button"
              aria-label="Composer options"
              title="Composer options"
              className={cn(
                ROUND,
                "bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            />
          ) : (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="More composer controls"
              title="More composer controls"
              className="shrink-0 text-muted-foreground"
            />
          )
        }
      >
        {plus ? <Plus aria-hidden className="size-4" /> : <Ellipsis />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="top"
          align={plus ? "start" : "end"}
          sideOffset={6}
          collisionPadding={8}
          className="isolate z-50"
        >
          <Menu.Popup data-surface="overlay" data-testid="composer-overflow-menu" className={POPUP}>
            {actions && (
              <>
                <Menu.Item
                  data-testid="composer-plus-attach"
                  className={ITEM}
                  onClick={actions.onAttach}
                >
                  <Paperclip aria-hidden />
                  Attach files…
                </Menu.Item>
                <Menu.Item
                  data-testid="composer-plus-commands"
                  className={ITEM}
                  onClick={actions.onCommands}
                >
                  <Terminal aria-hidden />
                  Commands &amp; skills
                  <span className="ml-auto pl-3 font-mono text-xs text-muted-foreground">/</span>
                </Menu.Item>
                <Menu.Item
                  data-testid="composer-plus-mention"
                  className={ITEM}
                  onClick={actions.onMention}
                >
                  <AtSign aria-hidden />
                  Mention file
                  <span className="ml-auto pl-3 font-mono text-xs text-muted-foreground">@</span>
                </Menu.Item>
                {pickers.length > 0 && (
                  <div role="separator" className="-mx-1 my-1 h-px bg-border" />
                )}
              </>
            )}
            {pickers.map((picker) => (
              <Menu.SubmenuRoot
                key={picker.id}
                open={openSub === picker.id}
                onOpenChange={(next) => onOpenSubChange(next ? picker.id : undefined)}
              >
                <Menu.SubmenuTrigger
                  data-testid={`composer-option-${picker.id}`}
                  className={cn(
                    ITEM,
                    "data-[popup-open]:bg-accent",
                    picker.warning && "text-status-needs",
                  )}
                  title={picker.warning}
                >
                  {picker.icon}
                  {picker.label}
                  <span className="ml-auto max-w-28 truncate pl-3 text-xs text-muted-foreground">
                    {picker.options.find((option) => option.value === picker.value)?.label}
                  </span>
                  <ChevronRightIcon aria-hidden />
                </Menu.SubmenuTrigger>
                <Menu.Portal>
                  <Menu.Positioner
                    side={plus ? "top" : "right"}
                    alignOffset={-4}
                    collisionPadding={8}
                    className="isolate z-50"
                  >
                    <Menu.Popup data-surface="overlay" aria-label={picker.label} className={POPUP}>
                      <Menu.RadioGroup
                        value={picker.value ?? null}
                        onValueChange={(next: string | null) => {
                          if (next !== null) picker.onChange(next);
                        }}
                      >
                        {picker.options.map((option) => (
                          <Menu.RadioItem
                            key={option.value}
                            value={option.value}
                            disabled={option.disabled}
                            closeOnClick
                            className={ITEM}
                          >
                            <span className="flex size-3.5 items-center justify-center">
                              <Menu.RadioItemIndicator>
                                <CheckIcon aria-hidden />
                              </Menu.RadioItemIndicator>
                            </span>
                            {option.label}
                          </Menu.RadioItem>
                        ))}
                      </Menu.RadioGroup>
                      {picker.description && (
                        <p className="max-w-72 px-2 py-1 text-xs text-muted-foreground">
                          {picker.description}
                        </p>
                      )}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.SubmenuRoot>
            ))}
            {steer && (
              <Menu.Item disabled={steer.disabled} className={ITEM} onClick={steer.run}>
                <Send aria-hidden />
                {steer.label}
              </Menu.Item>
            )}
            {actions?.onStop && (
              <>
                <div role="separator" className="-mx-1 my-1 h-px bg-border" />
                <Menu.Item
                  data-testid="composer-plus-stop"
                  className={cn(ITEM, "text-destructive")}
                  onClick={actions.onStop}
                >
                  <Square aria-hidden className="fill-current" />
                  Stop turn
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
