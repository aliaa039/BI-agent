import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
    Workspace,
    LocalFilesystem,
    LocalSandbox,
    WORKSPACE_TOOLS,
} from "@mastra/core/workspace";

// Anchor to this file so the workspace path is independent of CWD.
// - source (bun/tsx):     src/mastra/workspace.ts -> ../../dashboard-workspace = <project>/dashboard-workspace
// - mastra dev / start:   .mastra/output/index.mjs -> ../../dashboard-workspace = <project>/dashboard-workspace
const here = dirname(fileURLToPath(import.meta.url));
export const basePath =
    process.env.WORKSPACE_PATH ?? resolve(here, "../../dashboard-workspace");

export const dashboardWorkspace = new Workspace({
    id: "dashboard-workspace",
    name: "Dashboard Workspace",
    filesystem: new LocalFilesystem({ basePath }),
    sandbox: new LocalSandbox({ workingDirectory: basePath }),
    skills: ["skills"],
    bm25: true,
    tools: {
        // Keep background processes (e.g. `npm run dev`, `npm run preview`)
        // alive across agent turns. Without this, the default abort signal
        // SIGKILLs every spawned process when the model finishes its reply.
        // See docs/workspace-isolation-notes.md
        [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
            backgroundProcesses: {
                abortSignal: false,
            },
        },
    },
});
