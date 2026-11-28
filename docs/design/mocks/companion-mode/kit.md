# Companion skins: proposal

[Up: companion mode brief](brief.md) · boards "Skin picker" and "Skin import" in [v2](v2.html)

A person can change how the companion looks without changing how it works. A skin is a small
manifest with a few SVGs. It sets the avatar's shape, its face in each state, its motion, its tool
glyphs and the glass. Colours stay with the person's palette and accent, so a skin looks right in
every theme and in both modes.

## Built on what Gram has

- **Colour.** A skin never carries colour values. It names token roles (`accent`, `on-accent`,
  `fg`, `surface-3`, `status-needs-mark`, `danger`), and SVGs paint with `currentColor` or
  `var(--role)`. The palette, accent and mode come from `@gram/themes` as they do today.
- **Look defaults.** A skin can suggest a `look`: `accent`, `palette`, `backdrop` or `surfaces`,
  with the same names as `LookDefaults` in `apps/web/src/embed/contract.ts`. Like an embedder's
  defaults, a suggestion applies only where the person hasn't chosen.
- **Glass.** The dropdown uses the glass look's `--surface-alpha` and `--surface-blur`. Surfaces
  set to Solid wins over any skin's glass.
- **Motion.** Motion follows Settings → Motion (`data-motion`). A skin's `intensity` can only lower
  it: `still`, `calm` or `lively`, where `lively` is today's full motion. Reduced or Off holds
  every skin still.
- **Embedders.** A host could ship its own skins and pick a default for its
  members through a mount option (`defaults.companion: "moss"`, `shell.companionSkins: [...]`), in
  the same way it sets `theme` and `defaults` today.

## The manifest (`gram.companion-skin/1`)

| Field             | What it is                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `name`            | 1 to 40 characters                                                                                |
| `avatar.shape`    | `circle`, `rounded` or `square`; `size` is 32 to 56 px                                            |
| `avatar.position` | Optional default corner. The person's own setting wins                                            |
| `faces`           | An SVG for each of `idle`, `working`, `needs` and `error`. A missing face falls back to `idle`    |
| `motion`          | A preset per state from a fixed list (below); `intensity` is `still`, `calm` or `lively`          |
| `tools`           | Optional SVGs for the tool badge, by kind: `terminal`, `search`, `file`, `worker`, `web`, `other` |
| `glass`           | `tint` (a token role or `none`), `alpha` 0.4 to 1, `blur` 0 to 32 px, `radius` 8 to 28 px         |
| `look`            | Optional `LookDefaults` suggestion                                                                |

The motion presets are named CSS keyframes that Gram ships: `blink`, `breathe`, `glow`, `nudge`
and `none`. A skin picks names from this list and cannot write its own CSS.

SVG faces may animate themselves with SMIL (`<animate>`, `<animateTransform>`). SMIL runs no
script, and Reduced motion pauses it (`svg.pauseAnimations()`). Lottie is left out of version 1
because it needs a player library and a JSON format that is hard to bound.

## Picking, previewing and importing

- **Settings → Appearance → Companion.** A card per skin plays its four states side by side. Beside
  the cards: corner, size, motion and glass. A change shows on the live companion at once.
- **Import.** A `.gramskin` file (a zip of `skin.json` plus `faces/` and `tools/`), or a single JSON
  file with the SVGs inline. Before anything is offered, the dialog lists what was checked and
  what was removed (board "Skin import").
- **From a prompt.** "Make me a skin that looks like a moss ball." Gram's AI helper, if the person
  turned it on, writes the manifest and the SVGs. Its output goes through the same import checks
  and arrives as a preview, never applied directly.
- **Sharing.** Export writes the same `.gramskin` file. Skins live in the person's settings, which
  already sync to the server when the app uses it.

## What is safe to accept

- **No script, anywhere.** SVGs go through an allowlist sanitizer (DOMPurify's SVG profile with
  SMIL allowed). It removes:
  - `<script>` and `<foreignObject>`;
  - every `on*` attribute;
  - `javascript:` and `data:` URLs;
  - external `href`/`xlink:href`;
  - `<style>` that imports anything, and `@font-face`.
- **No network.** Nothing is fetched: no external images, fonts or links. Everything is in the file.
- **Bounded.**
  - Files: 512 KB per skin, 64 KB per SVG, at most 16 files.
  - SVG content: a `viewBox` is required, at most 2,000 elements, and nesting at most 32 deep.
  - The manifest is checked against its schema, and unknown fields are refused rather than ignored.
- **Rendered inert.** Faces are drawn as `<img src="blob:…">` from the sanitized SVG, not inlined,
  so even an SVG that got past the sanitizer cannot run code or reach the page.

  To colour faces by theme instead, the sanitized SVG is inlined in a closed shadow root with the
  allowed roles passed in. That's the one place the sanitizer is the only guard, and the open
  question below picks between the two.

- **Readable.** Each face must keep 3:1 against the glass in both modes, checked with
  `@gram/themes` contrast. A skin that fails is refused, with the state it failed in named.

## Built-in examples

- **Gram**: today's face. Accent fill, eyes and mouth in `on-accent`.
- **Pebble**: no face. A filled circle with one inner mark per state (dot, square, amber dot,
  red).
- **Prompt**: a rounded square in mono: `>_`, `>…`, `>?`, `>!`.

All three use only the presets and token roles above, so they also serve as the examples a person
copies.

## Open question

How faces are drawn:

- **Image (`<img>`, safest).** Faces can't follow the theme's colours, so a skin draws its own
  colours and passes the contrast check in both modes.
- **Inline in a shadow root (`currentColor` and roles work).** Relies on the sanitizer. Recommended
  for built-ins, with `<img>` for imported skins.
