import type { CSSProperties } from "react";

import type { AvatarState } from "./companion-model";

/** A palette token by its name without `--`: a skin names roles, never colours. */
export type TokenRole =
  | "fg"
  | "surface-1"
  | "surface-3"
  | "accent"
  | "on-accent"
  | "danger"
  | "status-needs-mark";

/** Named keyframes Gram ships; a skin picks from these and writes no CSS of its own. */
export type MotionPreset = "none" | "glow" | "blink" | "breathe" | "nudge";

/** What the icon draws in one state: its body, and the mark inside it. */
export interface SkinFace {
  readonly body: TokenRole;
  readonly mark: { readonly shape: "dot" | "square" | "cross"; readonly fill: TokenRole };
  readonly motion: MotionPreset;
}

/**
 * A companion skin, shaped as `gram.companion-skin/1` in the kit proposal
 * (docs/design/mocks/companion-mode/kit.md). Pebble is the only one this round; SVG faces, tool
 * glyphs and importing come with the kit.
 */
export interface CompanionSkin {
  readonly schema: "gram.companion-skin/1";
  readonly id: string;
  readonly name: string;
  readonly avatar: { readonly shape: "circle"; readonly size: number };
  readonly faces: Readonly<Record<AvatarState | "needs", SkinFace>>;
  readonly glass: {
    readonly tint: TokenRole;
    /** How much of the tint shows, 0.4 to 1; 1 is solid. */
    readonly alpha: number;
    readonly blur: number;
    readonly radius: number;
  };
}

export const PEBBLE: CompanionSkin = {
  schema: "gram.companion-skin/1",
  id: "pebble",
  name: "Pebble",
  avatar: { shape: "circle", size: 40 },
  faces: {
    idle: { body: "fg", mark: { shape: "cross", fill: "surface-1" }, motion: "none" },
    working: { body: "fg", mark: { shape: "cross", fill: "accent" }, motion: "glow" },
    needs: { body: "fg", mark: { shape: "cross", fill: "status-needs-mark" }, motion: "none" },
    error: { body: "danger", mark: { shape: "cross", fill: "surface-1" }, motion: "none" },
  },
  glass: { tint: "surface-3", alpha: 0.58, blur: 22, radius: 18 },
};

/** The glass's opacity in the desktop app's own window, over the desktop (companion.css). */
export const WINDOW_GLASS_ALPHA = 0.95;

const role = (token: TokenRole) => `var(--${token})`;

/** The face for a state; asking outranks the mood, as the amber mark does everywhere. */
export const faceOf = (skin: CompanionSkin, state: AvatarState, asks: boolean): SkinFace =>
  asks && state !== "error"
    ? { ...skin.faces.needs, motion: skin.faces[state].motion }
    : skin.faces[state];

/** The custom properties the icon and the glass read from a skin. */
export const skinStyle = (skin: CompanionSkin, face: SkinFace): CSSProperties =>
  Object.assign<CSSProperties, Readonly<Record<`--companion-${string}`, string>>>(
    {},
    {
      "--companion-size": `${skin.avatar.size}px`,
      "--companion-body": role(face.body),
      "--companion-mark": role(face.mark.fill),
      "--companion-mark-radius": face.mark.shape === "dot" ? "9999px" : "3px",
      "--companion-glass-tint": role(skin.glass.tint),
      "--companion-glass-alpha": `${Math.round(skin.glass.alpha * 100)}%`,
      "--companion-glass-blur": `${skin.glass.blur}px`,
      "--companion-glass-radius": `${skin.glass.radius}px`,
    },
  );
