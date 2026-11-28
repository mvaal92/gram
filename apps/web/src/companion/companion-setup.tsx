import type { Project, ProjectId, WorkspaceId, WorkspaceState } from "@gram/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useApi } from "@/api/context";
import { errorMessage } from "@/api/errors";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useModelsSettled } from "@/composer/models";
import { cn } from "@/lib/utils";
import {
  createInput,
  emptyNewWorkspace,
  subscriptionWorkspaceCharter,
  toggleRepo,
  workspaceNameFor,
} from "@/orchestration/new-workspace-model";
import { useWorkspacesQuery } from "@/orchestration/use-orchestration";
import { projectNameOf } from "@/settings/workspace-settings-model";
import { useServerSettings } from "@/settings-sync/store";
import { DialogShell } from "@/thread/dialog-shell";
import { useViewWorkspace } from "@/views/view-workspace";

import { faceOf, PEBBLE, skinStyle } from "./companion-skin";
import { useCompanion } from "./companion-store";

const NEW = "new";

const close = () => useCompanion.getState().setSetupOpen(false);

/** The orchestrator the setup opens on: the linked one, the one in view, else any that runs. */
export const defaultPick = (
  workspaces: readonly WorkspaceState[],
  linked: string | undefined,
  viewed: string | undefined,
): WorkspaceId | typeof NEW =>
  (
    workspaces.find((w) => w.workspace.id === linked) ??
    workspaces.find((w) => w.workspace.id === viewed) ??
    workspaces.find((w) => w.workspace.orchestratorThreadId !== undefined) ??
    workspaces[0]
  )?.workspace.id ?? NEW;

/**
 * Companion setup, as few choices as a new personal bot: which orchestrator it talks to (one of
 * yours, or a new one with a name), its skin, and whether it pings. A new orchestrator works in
 * the repository of the workspace in view unless another is picked; its model and autonomy are
 * the new-workspace defaults. Turning it on saves the link and shows the companion.
 */
export function CompanionSetup() {
  const open = useCompanion((s) => s.setupOpen);
  if (!open) return null;
  return <SetupDialog />;
}

function SetupDialog() {
  const api = useApi();
  const queryClient = useQueryClient();
  const linked = useCompanion((s) => s.workspaceId);
  const savedPings = useCompanion((s) => s.pings);
  const alreadyOn = useCompanion((s) => s.on);
  const viewed = useViewWorkspace();
  const { workspaces, settled } = useWorkspacesQuery();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const settings = useServerSettings((s) => s.settings);
  const claude = useModelsSettled("claude");
  const codex = useModelsSettled("codex");

  const [picked, setPicked] = useState<WorkspaceId | typeof NEW | undefined>(undefined);
  const pick =
    picked ?? (settled ? defaultPick(workspaces, linked, viewed?.workspace.id) : undefined);
  const [name, setName] = useState("");
  const [repos, setRepos] = useState<readonly ProjectId[] | undefined>(undefined);
  const defaultRepo = viewed?.workspace.homeProjectId ?? projects[0]?.id;
  const chosenRepos = repos ?? (defaultRepo === undefined ? [] : [defaultRepo]);
  const [changingRepos, setChangingRepos] = useState(false);
  const [pings, setPings] = useState(savedPings);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string>();

  const turnOn = async (event: FormEvent) => {
    event.preventDefault();
    if (pick === undefined || busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      let workspaceId: WorkspaceId;
      if (pick === NEW) {
        const draft = chosenRepos.reduce((each, id) => toggleRepo(each, id, true), {
          ...emptyNewWorkspace,
          name,
        });
        const starting = subscriptionWorkspaceCharter(
          settings,
          claude.settled ? claude.models : undefined,
          codex.settled ? codex.models : undefined,
        );
        const result = createInput(draft, starting, projects, workspaces);
        if ("error" in result) {
          setBusy(false);
          if (result.field === "repositories") setChangingRepos(true);
          return setIssue(result.error);
        }
        const state = await api.saveWorkspace(result.input);
        workspaceId = state.workspace.id;
        await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      } else {
        workspaceId = pick;
      }
      const has = workspaces.find((w) => w.workspace.id === workspaceId);
      if (has?.workspace.orchestratorThreadId === undefined) {
        await api.openOrchestrator({ workspaceId });
        await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      }
      const companion = useCompanion.getState();
      companion.link({ workspaceId, skin: PEBBLE.id, pings });
      companion.setSetupOpen(false);
      companion.set(true);
    } catch (error) {
      setBusy(false);
      setIssue(errorMessage(error) || "Couldn't start the orchestrator.");
    }
  };

  const placeholder =
    chosenRepos[0] === undefined
      ? "Name"
      : workspaceNameFor({ homeProjectId: chosenRepos[0] }, projects, workspaces);

  return (
    <DialogShell
      testId="companion-setup"
      title="Companion"
      description="A small icon on your desktop that talks to one orchestrator, follows its work and pings you."
      onClose={close}
    >
      <form onSubmit={(event) => void turnOn(event)} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-meta text-muted-foreground">Talks to</legend>
          <div role="radiogroup" aria-label="Talks to" className="grid grid-cols-3 gap-2">
            {workspaces.map((state) => (
              <Tile
                key={state.workspace.id}
                selected={pick === state.workspace.id}
                onSelect={() => setPicked(state.workspace.id)}
                label={state.workspace.name}
                trail={
                  state.workspace.orchestratorThreadId === undefined ? "Not started" : undefined
                }
                icon={<Network aria-hidden className="size-icon-row text-orchestrator" />}
              />
            ))}
            <Tile
              selected={pick === NEW}
              onSelect={() => setPicked(NEW)}
              label="New"
              testId="companion-setup-new"
              icon={<Plus aria-hidden className="size-icon-row text-muted-foreground" />}
            />
          </div>
          {pick === NEW && (
            <div className="flex flex-col gap-2">
              <Input
                aria-label="Name"
                data-testid="companion-setup-name"
                autoFocus
                value={name}
                placeholder={placeholder}
                onChange={(event) => setName(event.target.value)}
              />
              <RepoLine
                projects={projects}
                chosen={chosenRepos}
                changing={changingRepos}
                onChange={() => setChangingRepos(true)}
                onToggle={(id, on) =>
                  setRepos(on ? [...chosenRepos, id] : chosenRepos.filter((each) => each !== id))
                }
              />
            </div>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-meta text-muted-foreground">Skin</legend>
          <div role="radiogroup" aria-label="Skin" className="grid grid-cols-3 gap-2">
            <Tile
              selected
              onSelect={() => undefined}
              label={PEBBLE.name}
              icon={
                <span
                  aria-hidden
                  data-mark={faceOf(PEBBLE, "idle", false).mark.shape}
                  className="companion-pebble companion-pebble-sample grid shrink-0 place-items-center rounded-full"
                  style={skinStyle(PEBBLE, faceOf(PEBBLE, "idle", false))}
                >
                  <span className="companion-mark" />
                </span>
              }
            />
          </div>
        </fieldset>
        <label className="flex items-center justify-between gap-3 text-body">
          <span>Ping me when work finishes or needs me</span>
          <Switch checked={pings} onCheckedChange={setPings} data-testid="companion-setup-pings" />
        </label>
        {issue !== undefined && <FormError message={issue} />}
        <p className="text-meta text-subtle">
          Back to full Gram: double-click the icon or press Ctrl+Alt+6.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            data-testid="companion-setup-on"
            disabled={busy || pick === undefined}
          >
            {alreadyOn ? "Save" : "Turn on companion"}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function Tile({
  selected,
  onSelect,
  label,
  trail,
  icon,
  testId,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  trail?: string | undefined;
  icon: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-meta outline-none focus-visible:focus-ring",
        selected
          ? "border-primary bg-surface-2 text-foreground"
          : "border-edge text-muted-foreground hover:bg-surface-2",
      )}
    >
      {icon}
      <span className="w-full truncate text-center">{label}</span>
      {trail !== undefined && <span className="text-subtle">{trail}</span>}
    </button>
  );
}

function RepoLine({
  projects,
  chosen,
  changing,
  onChange,
  onToggle,
}: {
  projects: readonly Project[];
  chosen: readonly ProjectId[];
  changing: boolean;
  onChange: () => void;
  onToggle: (id: ProjectId, on: boolean) => void;
}) {
  if (!changing) {
    return (
      <p className="flex items-center gap-1 text-meta text-muted-foreground">
        <span className="truncate">
          Works in{" "}
          {chosen.length === 0
            ? "no repository yet"
            : chosen.map((id) => projectNameOf(projects, id)).join(", ")}
        </span>
        <Button type="button" size="xs" variant="link" onClick={onChange}>
          Change
        </Button>
      </p>
    );
  }
  return (
    <ul
      aria-label="Repositories"
      className="flex max-h-40 flex-col gap-1 overflow-y-auto text-meta"
    >
      {projects.map((project) => (
        <li key={project.id}>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={chosen.includes(project.id)}
              onCheckedChange={(on) => onToggle(project.id, on === true)}
            />
            <span className="truncate">{projectNameOf(projects, project.id)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
