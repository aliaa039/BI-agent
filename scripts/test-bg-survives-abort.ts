/**
 * Verifies the fix in src/mastra/workspace.ts:
 *   tools[EXECUTE_COMMAND].backgroundProcesses.abortSignal = false
 *
 * Without the fix, aborting the controller passed to the tool would SIGKILL
 * the spawned background process (default `abortSignal: undefined` means the
 * tool wires our signal into the child). With the fix, the process must
 * survive the abort.
 *
 * Run:  bun scripts/test-bg-survives-abort.ts
 * Pass: prints { alive: true } and exits 0.
 */
import { dashboardWorkspace } from "../src/mastra/workspace";
import {
    createWorkspaceTools,
    WORKSPACE_TOOLS,
} from "@mastra/core/workspace";

const tools = await createWorkspaceTools(dashboardWorkspace);
const exec = tools[WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND];
if (!exec?.execute) throw new Error("execute_command tool not found");

const controller = new AbortController();

// A trivial long-running process: sleep 60s then exit.
const result: any = await exec.execute(
    { command: 'node -e "setInterval(()=>{},1000)"', background: true },
    { workspace: dashboardWorkspace, abortSignal: controller.signal },
);

// Tool returns a human-readable string like "Started background process (PID: 26944)"
const pidMatch =
    typeof result === "string"
        ? result.match(/PID:?\s*(\d+)/i)
        : null;
const pid = Number(
    pidMatch?.[1] ?? result?.pid ?? result?.processId ?? result?.process?.pid,
);
if (!Number.isFinite(pid)) {
    console.error("no pid in tool result:", result);
    process.exit(2);
}
console.log("spawned pid:", pid);

// Simulate an agent turn ending: abort the signal that was passed to the tool.
controller.abort();
await Bun.sleep(800);

const alive = (() => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
})();

console.log({ pid, alive });

// Cleanup so we don't leak the test process.
try {
    process.kill(pid);
} catch {
    /* already gone */
}

if (!alive) {
    console.error("FAIL: process was killed by the aborted signal.");
    process.exit(1);
}
console.log("PASS: background process survived abort.");
