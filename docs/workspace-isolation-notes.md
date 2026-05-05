# Workspace isolation — findings & plan

Notes on confining the dashboard agent to `dashboard-workspace/` so it cannot read or execute outside that directory.

## What's already enforced

### `LocalFilesystem` — contained by default

`@mastra/core/workspace` `LocalFilesystem` accepts a `contained` option that defaults to **`true`**. With containment on:

- All file paths are resolved relative to `basePath`.
- Leading slashes are stripped (`/docs/x.md` → `docs/x.md` under `basePath`).
- Path traversal (`..`) and symlink escapes are blocked.
- `allowedPaths: []` means no extra directories are reachable.

Conclusion: the filesystem tools (`read_file`, `write_file`, `edit_file`, `list_files`, `delete`, `mkdir`, `file_stat`, `grep`) **cannot reach outside** `dashboard-workspace/`. No code change needed.

### `LocalSandbox` env defaults

By default, only `PATH` is forwarded to spawned commands. `process.env` (including `AZURE_API_KEY` etc.) is **not** exposed unless we explicitly pass it. Good baseline.

## What's NOT enforced

### Native OS isolation is unavailable on Windows

`LocalSandbox` supports OS-level isolation only on:

- macOS — Seatbelt (`sandbox-exec`)
- Linux — Bubblewrap (`bwrap`)

`LocalSandbox.detectIsolation()` on this machine:

```json
{
  "backend": "none",
  "available": false,
  "message": "Native sandboxing is not supported on win32. Commands will run without isolation."
}
```

So shell commands the agent runs via `execute_command` are **not** filesystem-isolated at the OS level on Windows. With `workingDirectory` set to `dashboard-workspace/`, processes start there, but nothing prevents them from `cd ..` or referencing absolute paths.

### `npm` walks up to find `package.json`

The "escape" observed in the trace was not an isolation bypass:

```
$ npm run dev
> dev
> mastra dev
```

The agent ran `npm run dev` inside `dashboard-workspace/`. That folder has no `package.json`, so `npm` walked **up** the directory tree, found the project-root `package.json`, and ran its `dev` script (which is `mastra dev`). This is npm's documented behavior — not a sandbox failure.

## Three-layer mitigation plan

### Layer 1 — make filesystem containment explicit (cosmetic)

`contained: true` is the default; setting it explicitly in `src/mastra/workspace.ts` documents intent.

### Layer 2 — auto-enable native isolation when available

```ts
import { LocalSandbox } from "@mastra/core/workspace";

const detection = LocalSandbox.detectIsolation();
const isolation = detection.available ? detection.backend : undefined;
```

No-op on Windows; activates seatbelt/bwrap on Mac/Linux. Makes the same code portable to CI or a Linux deploy.

### Layer 3 — stop npm from walking up

Add a barrier `package.json` at `dashboard-workspace/package.json`:

```json
{
  "name": "dashboard-workspace-barrier",
  "private": true,
  "version": "0.0.0",
  "description": "Boundary marker so npm/pnpm/yarn stop walking up from agent commands.",
  "scripts": {}
}
```

With this file in place:

- `npm run <anything>` from `dashboard-workspace/` or its subdirs that don't define the script will fail at this folder instead of escaping to the project root.
- The Evidence app's own `package.json` at `dashboard-workspace/dashboard-app/package.json` continues to work normally (npm finds it first).

### Layer 4 (optional) — restrict env explicitly

Pass an empty/minimal `env` to `LocalSandbox` rather than relying on the default PATH-only behavior, to make secret isolation explicit:

```ts
new LocalSandbox({
  workingDirectory: basePath,
  isolation,
  env: { PATH: process.env.PATH ?? "" },
});
```

## Honest limitations on Windows

Even with all layers in place, on Windows we cannot prevent a determined shell command from reading outside `dashboard-workspace/` (e.g., `type C:\Users\...\file.txt` would work). The defenses are:

- Filesystem tools: hard-blocked by `LocalFilesystem` containment.
- Shell commands: defaults steer them to stay inside (cwd + barrier + restricted env), but the OS doesn't enforce it.

For true OS-level enforcement on Windows, you'd need a container (Docker) or a different sandbox provider (`E2BSandbox`, `DaytonaSandbox`, etc.). For now, accept the soft boundary on Windows and rely on hard isolation when running on Linux/Mac/CI.

---

# Background processes die after every agent turn — root cause & fix

Separate problem, found while debugging "agent can't keep a web server alive". Documented here because it's tightly coupled to `LocalSandbox` configuration.

## Symptom

Agent calls `mastra_workspace_execute_command` with `background: true` to start `npm run preview` (Evidence) or `npm run dev`. On the same turn it sometimes sees `Accepting connections at http://localhost:3000`. By the next turn:

- Process is gone (PID untracked or `running: false`).
- HTTP probe to `localhost:3000` returns `Unable to connect`.
- Agent rationalizes it as "tool environment doesn't keep servers alive."

The agent's rationalization is wrong but pointing at the right area.

## Empirical baseline

Spawning the same command from `pwsh` directly (outside `LocalSandbox`):

```pwsh
Start-Process npm.cmd -ArgumentList "run","preview" `
  -WorkingDirectory ".\dashboard-workspace\dashboard-app" `
  -RedirectStandardOutput preview.out -RedirectStandardError preview.err
```

Result after 6 seconds:

- stdout contains `INFO Accepting connections at http://localhost:3000`
- HTTP probe to `http://localhost:3000/` → **200 OK**
- Process still running.

So Evidence + the build artifact + port 3000 are all fine. The bug lives in `LocalSandbox`'s lifecycle, not the app.

## Root cause: agent abort signal kills background processes

From `node_modules/@mastra/core/dist/workspace/tools/types.d.ts:111-118`:

```ts
/**
 * Abort signal for background processes.
 * - `undefined` (default): uses the agent's abort signal from context
 *   (processes are killed when the signal fires)
 * - `null` or `false`: disables abort signal
 *   (processes persist after disconnect).
 *   Use this for cloud sandboxes (e.g. E2B) where processes should
 *   survive agent shutdown.
 */
abortSignal?: AbortSignal | null | false;
```

By default, every `background: true` spawn from `execute_command` is wired to the **agent's abort signal**. That signal fires when the agent's current turn ends (response delivered to the client). Result: the background process gets `SIGKILL`'d milliseconds after the model's reply hits the user.

This means the typical "start server then probe it" flow only works *within a single turn*. Across turns, the process is always gone.

The same comment ("`Use this for cloud sandboxes... where processes should survive agent shutdown`") applies verbatim to `LocalSandbox` for any persistent server.

## Compounding factor: read timing

Even within a single turn, polling stdout immediately after spawn shows only npm's echo (`> evidence preview`). Evidence took ~6 seconds in my baseline test before printing `Accepting connections`. If the agent samples at t=1s and concludes "server didn't start", it may follow up with `kill_process` and never see the bind line.

## Fix — disable abort signal for our workspace

Configure the workspace's `execute_command` tool with `backgroundProcesses.abortSignal: false`. This is set on the `Workspace.tools` config:

```ts
import { Workspace, WORKSPACE_TOOLS } from "@mastra/core/workspace";

export const dashboardWorkspace = new Workspace({
  // ...
  tools: {
    [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
      backgroundProcesses: {
        abortSignal: false, // server survives across agent turns
        // optional lifecycle visibility:
        onExit: ({ pid, exitCode }) =>
          console.log(`[bg ${pid}] exited ${exitCode}`),
      },
    },
  },
});
```

After this change:

- A spawned dev/preview server keeps running between turns.
- Agent can poll `get_process_output` and HTTP-probe across multiple turns.
- Agent (or developer) is responsible for explicit cleanup via `kill_process`.

Trade-off: orphan processes accumulate if the agent forgets to kill them. Worth pairing with a small startup-time cleanup (`sandbox.processes.list()` then kill anything tagged from previous runs) or a process-tag convention.

## Recommended agent flow for web servers

1. `execute_command` with `background: true`, capture PID.
2. Loop with backoff (1s, 2s, 4s, up to ~15s): `get_process_output(pid, { tail: 50 })`. Look for the bind/ready line.
3. Once seen — or as a parallel check — HTTP-probe the URL. Treat 2xx/3xx as alive. Don't treat "no new stdout" as dead for idle servers.
4. When done, `kill_process(pid)`.

## References

- `node_modules/@mastra/core/dist/docs/references/reference-workspace-workspace-class.md` — `tools.backgroundProcesses` config
- `node_modules/@mastra/core/dist/docs/references/reference-workspace-process-manager.md` — `spawn`/`get`/`list`/`kill`, `ProcessHandle.wait`
- `node_modules/@mastra/core/dist/workspace/tools/types.d.ts:104-118` — `BackgroundProcessConfig` interface
- `node_modules/@mastra/core/dist/docs/references/reference-workspace-local-filesystem.md` — `contained`, `allowedPaths`, `readOnly`
- `node_modules/@mastra/core/dist/docs/references/reference-workspace-local-sandbox.md` — `isolation`, `nativeSandbox`, `detectIsolation()`
- `src/mastra/workspace.ts` — current workspace wiring
