# Companion mode

Written by the design-brief skill before the first version. Keep it short; it is what the mock is
checked against.

## Problem

Gram's full window (sidebar, board, panels) is a lot for someone who wants to talk to one agent.
Companion mode tries the personal-agent route: the whole UI becomes a small round animated avatar
floating on the screen and a small input window that shows the reply. Everything behind it stays
real: the orchestrator thread, its workers, and threads Runheim starts over `/embed/v1`.

## Who and where

One developer on the desktop app, or Gram mounted in Runheim. It is a mode toggle (setting and
shortcut); switching back restores the normal window untouched.

## Must show

- Avatar alone (idle), and its states: working, needs you, failed.
- The open bubble: one input, the latest reply text, nothing else by default.
- Tool calls in that tiny surface: three directions (status line, chips, avatar states).
- What waits on the user (an approval, a question) and Runheim-driven activity, as one compact card.
- The way back to the full UI.

## Out of scope

Board, sidebar, diffs, settings, multi-thread grid. They stay one toggle away.

## Open questions

- Which tool direction.
- Electron: shrink the window to a frameless always-on-top bubble, or keep the window and draw the
  avatar inside it. The prototype draws it inside the window.
