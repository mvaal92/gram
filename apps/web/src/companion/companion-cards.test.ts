import type { GramUIMessage } from "@gram/contracts";
import { describe, expect, it } from "vitest";

import { sharedIn } from "./companion-cards";

const message = (parts: unknown[]): GramUIMessage =>
  ({ id: "m", role: "assistant", parts }) as unknown as GramUIMessage;

describe("sharedIn", () => {
  it("finds the mock, the doc and a started preview's address, in order, and nothing else", () => {
    const shared = sharedIn(
      message([
        { type: "text", text: "Here it is." },
        {
          type: "data-mock",
          id: "1",
          data: { title: "Empty state", page: "/m/v1.html", directions: [] },
        },
        { type: "data-doc", id: "2", data: { id: "d1", title: "Plan" } },
        {
          type: "tool-mcp__gram__preview_start",
          toolCallId: "3",
          state: "output-available",
          input: { name: "web" },
          output: { content: [{ type: "text", text: "Serving at http://localhost:5173/ now" }] },
        },
        {
          type: "tool-Bash",
          toolCallId: "4",
          state: "output-available",
          input: {},
          output: "http://x.test",
        },
      ]),
    );
    expect(shared.map((each) => each.kind)).toEqual(["mock", "doc", "preview"]);
    expect(shared[2]).toEqual({ kind: "preview", url: "http://localhost:5173/" });
  });
});
