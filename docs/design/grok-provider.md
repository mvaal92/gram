# Grok provider

[Up: documentation map](../README.md) · [Agents and features](../AGENTS_AND_FEATURES.md) · [Agent package](../../packages/agents/ARCHITECTURE.md)

Grok is a third harness beside Claude Code and Codex. The same seams admit it: `AgentKind`,
`RuntimeAgent`, launch checks, the settings runtime row, orchestrator and worker admission, and
an `AgentHost`. Dreams stay on Claude Code and Codex. MCP settings targets stay `claude` and
`codex`. Codex remains the only gateway agent.

This build drives the local `grok` CLI (baseline 1.0.77). It does not call the xAI API directly.
A later runtime can sit behind the same `AgentHost` without a new picker.

## How a turn runs

Each turn is a new process. The prompt goes in a `0600` file under the thread home and is removed
when the process ends. The argv uses `--prompt-file`, `--verbatim`, `-m`, `--permission-mode`, and
`--output-format streaming-json`. `--rules` carries the standing instructions. That text is on the
command line, so it is visible to `ps`, and it is reapplied on every turn because each turn is a
new process.

`-s <uuid>` creates a session. `-r <uuid>` resumes it. `-s` creates the session even when the turn
fails, so a retry uses `-r`. The host marks the session as resume when that first process has a
pid, before it exits. A failed `-r` is not retried with `-s`. A fork is `-r <old> --fork-session
-s <new>`, and later turns resume the new id.

Headless Grok cannot ask for approval. `acceptEdits` and `auto` also pass `--allow Bash`, so a
worker can run commands. `plan`, `default`, and `dontAsk` do not. Deny rules still apply, and deny
beats allow. A refusal becomes one notice: "Grok refused a tool because a headless run cannot ask
for approval." Stderr is not logged.

## Isolation and sign-in

Each thread gets `GROK_HOME` at `dataDir/grok/threads/<threadId>/`. That home is not the user's
`~/.grok`, and Gram does not write `.grok/config.toml` into the repository. When the thread has a
Gram MCP endpoint with a bearer, `config.toml` names the server and the env var `GRAM_MCP_BEARER`.
The token is only in the child environment.

`GROK_AUTH_PATH` points at the existing auth file when a stat says the file is present. Gram does
not read or copy it. Sign-in is that stat plus whether `XAI_API_KEY` is non-empty. A present
session file counts as signed in even if a key is also set. The key's value is passed through to
the child and is never logged. Open fails only when the classification is `notSignedIn`. An
unreadable auth file with no key stays `unknown` and is allowed to start.

The launch check uses `which`, including a shell-script launcher. It does not use the Claude/Codex
resolver that skips wrappers. `notSignedIn` is an error when a Grok workflow is in use. `apiKey` is
a warning: a `grok login` session is preferred, and the key still starts threads.

## What the gate does not cover

The outward gate is repeated `--deny` rules (`Bash(git push)`, `Bash(gh pr merge)`, and the rest
of the publish and irreversible lists). Grok treats `Bash(git push)` as a prefix. A command that
does not match the prefix, or a push made outside Bash, is outside the gate. This is an accident
gate. It is not Claude's hook and it is not Codex's owned-home rules.

`GROK_DISABLE_AUTOUPDATER=1` is set on the child. There is no `--no-auto-update` flag on 1.0.77.

## Models, versions, and install

`grok models` fills the picker when it returns a list. Otherwise the builtin catalog is
`grok-4.7` (default), `grok-4.7-build-fast`, `grok-4.6`, and `grok-4.5`, each with reasoning
effort. The parser keeps id and display name. It drops `api_key`, `api_base_url`, `env_key`, and
`info`. Discovery asks Grok last, after Claude Code and Codex.

The settings row judges the CLI against 1.0.77 on the same minor line. Gram does not query npm
for Grok. If it is not installed, Settings shows `curl -fsSL https://x.ai/cli/install.sh | bash`
to copy and does not run that pipeline. A native install under `~/.grok/bin` can run `grok update`
when that update is the latest compatible release. The updater cannot pin a version.

## Tests

Unit and contract tests spawn `packages/agents/fixtures/grok/cli.cjs`. The fixture records argv
and whether secret env vars were set. It never writes the values. `packages/agents/src/grok/live.test.ts`
sends one prompt to the real CLI and skips when `grok` is missing or not signed in.
