# Mobile interface: decisions

One line per review round: what was asked, what changed, in which version. The mock-review skill
keeps this; the build reads it with the approved version.

- **v1 → approved (`A Sheet`):** Selected **A Sheet** over **B Tabbar** and **C Pill** so the phone view keeps 100% of vertical height for the transcript, Ask Stack, and composer when the software keyboard is open, opens `OverviewSidebar` and `RightPanel` as full-width sheets over `<main>` below 420 px (`sidebar: "over"`, `panel: "over"`), auto-closes the peeked overview when navigating or opening a thread, and stacks Board feature stations vertically on narrow containers (`@max-md/board`).
