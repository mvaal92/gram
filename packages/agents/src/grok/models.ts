import type { AgentModel, ReasoningVariant } from "@gram/contracts";

const EFFORTS: ReadonlyArray<ReasoningVariant> = ["none", "low", "medium", "high", "xhigh", "max"];

/** Public model ids so the picker works when `grok models` cannot be read. */
export const BUILTIN_MODELS: ReadonlyArray<AgentModel> = [
  {
    id: "grok-4.7",
    displayName: "Grok 4.7",
    supportsEffort: true,
    isDefault: true,
    efforts: EFFORTS,
  },
  {
    id: "grok-4.7-build-fast",
    displayName: "Grok 4.7 Fast",
    supportsEffort: true,
    efforts: EFFORTS,
  },
  { id: "grok-4.6", displayName: "Grok 4.6", supportsEffort: true, efforts: EFFORTS },
  { id: "grok-4.5", displayName: "Grok 4.5", supportsEffort: true, efforts: EFFORTS },
];

export const GROK_DEFAULT_MODEL = "grok-4.7";

const META = new Set([
  "auth_method",
  "origin",
  "identity",
  "models",
  "api_key",
  "api_base_url",
  "env_key",
  "info",
]);

const nameOf = (value: unknown, id: string): string => {
  if (typeof value !== "object" || value === null) return id;
  const record = value as Record<string, unknown>;
  for (const key of ["displayName", "display_name", "name"]) {
    const name = record[key];
    if (typeof name === "string" && name !== "" && name !== id) return name;
  }
  return id;
};

const row = (id: string, value: unknown, preferred: boolean): AgentModel => ({
  id,
  displayName: nameOf(value, id),
  supportsEffort: true,
  efforts: EFFORTS,
  ...(preferred ? { isDefault: true } : {}),
});

const fromList = (values: ReadonlyArray<unknown>): AgentModel[] | undefined => {
  const models: AgentModel[] = [];
  for (const value of values) {
    if (typeof value === "string" && value !== "") models.push(row(value, undefined, false));
    else if (typeof value === "object" && value !== null) {
      const id = (value as { id?: unknown }).id;
      if (typeof id === "string" && id !== "") models.push(row(id, value, false));
    }
  }
  return models.length === 0 ? undefined : markDefault(models);
};

const markDefault = (models: AgentModel[]): AgentModel[] => {
  if (models.some((model) => model.isDefault === true)) return models;
  const index = models.findIndex((model) => model.id === GROK_DEFAULT_MODEL);
  const at = index === -1 ? 0 : index;
  return models.map((model, i) => (i === at ? { ...model, isDefault: true } : model));
};

const fromRecord = (record: Record<string, unknown>): AgentModel[] | undefined => {
  const nested = record["models"];
  if (Array.isArray(nested)) return fromList(nested);
  if (typeof nested === "object" && nested !== null)
    return fromRecord(nested as Record<string, unknown>);
  const models: AgentModel[] = [];
  for (const [id, value] of Object.entries(record)) {
    if (META.has(id) || id === "") continue;
    models.push(row(id, value, false));
  }
  return models.length === 0 ? undefined : markDefault(models);
};

/** Parses `grok models` stdout. Drops every field except id and display name. */
export const parseGrokModels = (stdout: string): ReadonlyArray<AgentModel> | undefined => {
  const trimmed = stdout.trim();
  if (trimmed === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return fromList(parsed);
    if (typeof parsed === "object" && parsed !== null)
      return fromRecord(parsed as Record<string, unknown>);
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Za-z0-9._:-]+$/.test(line));
    if (lines.length > 0) return markDefault(lines.map((id) => row(id, undefined, false)));
  }
  return undefined;
};
