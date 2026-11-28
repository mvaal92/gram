import { CircleDot } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useShortcutHint, withHint } from "@/keyboard/use-shortcut-hint";

import { useCompanion } from "./companion-store";

/** The title bar's way into companion mode, beside its shortcut. */
export function CompanionButton({ className }: { className?: string }) {
  const keys = useShortcutHint("view.companion");
  const label = keys === undefined ? "Companion mode" : withHint("Companion mode", keys);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      title={label}
      aria-label="Companion mode"
      data-testid="companion-enter"
      onClick={() => useCompanion.getState().set(true)}
    >
      <CircleDot />
    </Button>
  );
}
