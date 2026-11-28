import { CircleDot } from "lucide-react";

import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { useShortcutHint, withHint } from "@/keyboard/use-shortcut-hint";

import { useCompanion } from "./companion-store";

/** The title bar's way into companion mode: its setup, where it is linked and turned on. */
export function CompanionButton({ className }: { className?: string }) {
  const keys = useShortcutHint("view.companion");
  const label = keys === undefined ? "Companion mode" : withHint("Companion mode", keys);
  return (
    <Hint
      label={label}
      side="bottom"
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          className={className}
          aria-label="Companion mode"
          data-testid="companion-enter"
          onClick={() => useCompanion.getState().setSetupOpen(true)}
        />
      }
    >
      <CircleDot />
    </Hint>
  );
}
