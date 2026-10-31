# Mobile interface

Written by the design-brief skill before the first version. Keep it short; it is what the mock is
checked against.

## Problem

When Gram is opened on a phone over Tailscale Serve (`GRAM_REMOTE_ORIGIN`, 390 × 844 CSS pixels):

- tapping **Show sidebar** crushes the Overview into a 30 px strip beside the 360 px chat minimum,
  clipping workspace tiles and worker rows;
- picking a thread or page from a peeked Overview does not dismiss the sidebar;
- the **Board** view squeezes its feature column and five stations (`Briefed`, `Working`, `Review`,
  `Checks`, `Merged`) into 390 px (~42 px per station), cutting off worker titles and PR numbers;
- transcript rows and request cards keep 24 px side margins (`px-6`), leaving less room for code,
  diffs and approvals.

## Who and where

An individual developer checking on their running Gram workspaces from a phone browser (390 × 844)
paired over Tailscale Serve, starting from an orchestrator or worker thread (`/t/$threadId`), the
Overview sidebar, the Board, or the Right Panel.

## Must show

Per direction, at 390 × 844:

- The orchestrator chat with a live feature card, the Ask Stack (an approval and a worker
  question), and the rounder composer.
- How the user reaches the **Overview** (Needs you pill, Orchestrators with Gram and `[Workspace]`,
  live workers, Solo threads, and 24-hour times such as `17:05` and `09:42`).
- How the **Board** lays out features and their stations on a 390 px screen without horizontal
  clipping, plus its empty state.
- How the **Right Panel** (`Diff`, `PR`, `Files`, `Terminal`, `Needs you`) opens over the thread
  and returns to chat.

Dark and light come from the bar's theme switch.

## Out of scope

- Native iOS or Android wrappers: phone access is the web renderer over Tailscale Serve.
- Remote authentication, pairing links and cookie storage (`packages/server/src/http/remote-access.ts`),
  which stay unchanged.
- Desktop and tablet layouts (`>= 420 px`), which keep their existing multi-column grid and rail.

## Open questions

Assumptions, each with the default picked:

- **Navigation chrome:** **A Sheet** keeps the single top title bar and opens Overview and Right
  Panel as full-width sheets over the main column (`sidebar: "over"`, `panel: "over"`), versus
  **B Tabbar** (persistent bottom tab bar) or **C Pill** (floating bottom switch). Default:
  **A Sheet**, preserving vertical space when the phone keyboard is up and matching `RightPanel`'s
  existing `over` mode.
- **Board layout at 390 px:** stack each feature's title and stage progress above its active
  workers, rather than scrolling a 6-column table horizontally. Default: stacked feature cards
  under `@max-md/board`.
- **Auto-close on pick:** tapping a thread, workspace or nav link while the Overview is open over
  the chat closes the Overview immediately. Default: yes.
