# Mobile interface: handoff

[Brief](brief.md) · [Decisions](decisions.md) · [Approved page](v1.html)

## Target

`v1.html`, direction **A Sheet** (board `#a-sheet`). The build must match its states at 390 × 844:

- **chat**: the single top title bar (`ShellTitlebar`) with secondary badges hidden, the transcript
  with 12 px horizontal padding (`@max-sm:px-3`), minimal live feature cards, the Ask Stack docked
  above the composer, and a single-row minimal composer showing only `+` (`composer-plus`), the
  message input, and the Post/Send button (opening `+` reveals attachments, `/` commands, `@`
  mentions, Model, Speed, Effort and Mode).
- **overview**: tapping **Show sidebar** (`[data-testid="overview-show"]`) or pressing `⌘B` on a
  phone viewport (`windowWidth < 420`) opens the full `OverviewSidebar` over `<main>` (`sidebar:
  "over"`, `sidebarWidth: windowWidth`), rather than crushing the compact rail into a 30 px strip.
  Tapping a thread, workspace or navigation link closes `sidebarPeek` so the destination is
  immediately visible.
- **board**: in a narrow board container (`@max-md/board`), the 5-column station header hides and
  each `FeatureLine` stacks its feature heading and stage above its active worker chips, with each
  station's label shown beside its workers.
- **panel**: tapping **Show right panel** (or opening Diff, PR, Files, Terminal, Needs you or
  Notifications) opens `RightPanel` over `<main>` (`panel: "over"`) at full width.
- **empty**: the Board and thread empty states center cleanly at 390 px.

## Decisions

- **A Sheet** was picked; **B Tabbar** and **C Pill** are dropped so no second navigation bar
  competes with the Ask Stack and software keyboard.
- Desktop and tablet breakpoints (`>= 420 px`) keep their existing `fitShell` behavior unchanged.
- All times remain 24-hour (`17:05`, `09:42`).

## Parts

| Mock                    | Build                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `.m-bar`                | `ShellTitlebar` in `apps/web/src/shell/shell-titlebar.tsx`                                |
| `.m-overview` (`over`)  | `fitShell` (`sidebar: "over"`) in `apps/web/src/stores/layout.ts` and `AppShell`          |
| `.m-panel` (`over`)     | `RightPanel` in `apps/web/src/components/right-panel.tsx` (`panelExpanded` / `over`)      |
| `.m-board`, `.m-bline`  | `RailBoard` and `FeatureLine` (`@container/board`) in `apps/web/src/views/board-view.tsx` |
| `.m-scroll`, `.m-fcard` | `Transcript`, `ThreadView` and `FeatureCardView` (`@max-sm:px-3`)                         |

## Deviations allowed

- Real thread titles, branch names, PR numbers and ages.
- Existing desktop/tablet widths (`>= 420 px`) continue to use `compact` or `full` sidebars beside
  the chat.

## Gaps

- `[Secondary workspace]` is filled by the user's real workspaces.
