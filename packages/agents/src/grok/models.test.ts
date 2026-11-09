import { describe, expect, it } from "vitest";
import { parseGrokModels } from "./models.ts";
import { grokSignInOf } from "./sign-in.ts";

const SECRET = "sk-sentinel-do-not-keep";

describe("parseGrokModels", () => {
  it("reads ids and names and drops credentials", () => {
    const models = parseGrokModels(
      JSON.stringify({
        auth_method: "session",
        "grok-4.7": { name: "Grok 4.7", api_key: SECRET, api_base_url: "https://example.invalid" },
        "grok-4.6": { display_name: "Grok 4.6" },
      }),
    );
    expect(models?.map((model) => model.id)).toEqual(["grok-4.7", "grok-4.6"]);
    expect(models?.[0]).toMatchObject({ displayName: "Grok 4.7", isDefault: true });
    expect(JSON.stringify(models)).not.toContain(SECRET);
    expect(JSON.stringify(models)).not.toContain("example.invalid");
  });

  it("accepts an array, a models list, and plain lines", () => {
    expect(parseGrokModels('["grok-4.5"]')?.[0]?.id).toBe("grok-4.5");
    expect(
      parseGrokModels('{"models":[{"id":"grok-4.7","name":"Grok 4.7"}]}')?.[0]?.displayName,
    ).toBe("Grok 4.7");
    expect(parseGrokModels("grok-4.7\ngrok-4.6\n")?.map((model) => model.id)).toEqual([
      "grok-4.7",
      "grok-4.6",
    ]);
    expect(parseGrokModels("")).toBeUndefined();
  });
});

describe("grokSignInOf", () => {
  it("prefers a session file over an API key", () => {
    expect(grokSignInOf("present", true)).toBe("signedIn");
    expect(grokSignInOf("absent", true)).toBe("apiKey");
    expect(grokSignInOf("absent", false)).toBe("notSignedIn");
    expect(grokSignInOf("unreadable", false)).toBe("unknown");
    expect(grokSignInOf("unreadable", true)).toBe("apiKey");
  });
});
