import { createTool } from "@mastra/core/tools";
import { requireSandbox } from "@mastra/core/workspace";
import { z } from "zod";

/**
 * Spawn a long-lived dev/preview server in the workspace sandbox and wait
 * until it is actually serving HTTP, all in a single tool call.
 *
 * Replaces the manual loop of:
 *   execute_command(background) -> get_process_output (poll) ... -> curl
 *
 * Behaviour:
 * - Spawns the command via `workspace.sandbox.processes.spawn` (background by
 *   construction). The agent's abort signal is NOT propagated to the child,
 *   so the server survives the agent turn ending.
 * - Polls the process's stdout/stderr for a ready signal AND HTTP-probes the
 *   given port concurrently. Whichever signal arrives first wins.
 * - Returns the wrapper PID either way. On timeout the process is LEFT
 *   RUNNING by design — the caller owns cleanup via the returned PID.
 */


//A list of regex patterns to detect when a dev server has started
const READY_PATTERNS_DEFAULT = [
    /Accepting connections at\s+http/i, // Evidence preview (sirv)
    /Local:\s+http/i, // Vite / Evidence dev
    /ready in\s+\d+/i, // Vite
    /listening on\s+http/i, // Generic
    /Server running at\s+http/i, // Generic
];

export const startDevServerTool = createTool({
    id: "start_dev_server",
    description:
        "Start a long-lived dev/preview server in the workspace sandbox and wait until it is actually serving HTTP on the given port. Spawns the command in the background, polls stdout for a ready line AND HTTP-probes the port in parallel, and returns the wrapper PID. On timeout the process is left running so the caller can inspect or kill it via the returned PID. Use this instead of execute_command(background) + get_process_output + curl for any dev/preview server.",
    inputSchema: z.object({
        command: z
            .string()
            .min(1)
            .describe(
                "Full shell command to spawn, e.g. 'npm run dev' or 'npm run preview'.",
            ),
        cwd: z
            .string()
            .describe(
                "Working directory relative to the workspace root, e.g. 'dashboard-app' for Evidence projects. Required so the agent never accidentally spawns from the workspace root.",
            ),
        port: z
            .number()
            .int()
            .min(1)
            .max(65535)
            .describe(
                "Port the server is expected to listen on. Used for the HTTP readiness probe. Required.",
            ),
        host: z
            .string()
            .optional()
            .default("localhost")
            .describe("Host for the readiness probe (default 'localhost')."),
        path: z
            .string()
            .optional()
            .default("/")
            .describe("URL path for the readiness probe (default '/')."),
        readyPattern: z
            .string()
            .optional()
            .describe(
                "Optional regex (as a string) to match against stdout/stderr to detect readiness. If omitted, common dev-server patterns are used (Vite, Evidence, generic 'listening on http').",
            ),
        timeoutMs: z
            .number()
            .int()
            .positive()
            .optional()
            .default(30000)
            .describe(
                "Total time to wait for readiness before giving up (default 30000ms). On timeout the process is left running.",
            ),
    }),
    outputSchema: z.object({
        pid: z.string(),
        ready: z.boolean(),
        url: z.string(),
        port: z.number(),
        elapsedMs: z.number(),
        readinessSignal: z
            .enum(["http", "stdout", "none"])
            .describe(
                "Which signal indicated readiness: 'http' = port responded, 'stdout' = ready line matched, 'none' = timed out.",
            ),
        httpStatus: z.number().nullable(),
        stdoutTail: z.string(),
        stderrTail: z.string(),
        exited: z.boolean().describe("True if the process exited before ready."),
        exitCode: z.number().nullable(),
        reason: z.string().nullable(),
    }),
    execute: async (input, executionContext) => {
        const command = input.command;
        const cwd = input.cwd;
        const port = input.port;
        const host = input.host ?? "localhost";
        const path = input.path ?? "/";
        const readyPattern = input.readyPattern;
        const timeoutMs = input.timeoutMs ?? 30000;

        const { sandbox } = requireSandbox(executionContext);
        if (!sandbox.processes) {
            throw new Error(
                "sandbox.processes is not available; cannot spawn long-lived processes",
            );
        }

        const url = `http://${host}:${port}${path.startsWith("/") ? path : `/${path}`}`;
//check for any pattern that tells that the system is running
        const patterns = readyPattern
            ? [new RegExp(readyPattern, "i")]
            : READY_PATTERNS_DEFAULT;

        // Deliberately do NOT pass executionContext.abortSignal — we want the
        // process to outlive the agent turn.
        const handle = await sandbox.processes.spawn(command, { cwd });
        const pid = handle.pid;
        const started = Date.now();

        const tail = (s: string, n = 1500) =>
            s.length <= n ? s : s.slice(-n);

        //check if the stdout or stderr contains any of the ready patterns
        const matchesStdout = () => {
            const buf = handle.stdout + "\n" + handle.stderr;
            return patterns.some((re) => re.test(buf));
        };
//fetch("http://localhost:3000")
        const probeHttp = async (perRequestMs: number): Promise<number | null> => {
            try {
                const res = await fetch(url, {
                    method: "GET",
                    signal: AbortSignal.timeout(perRequestMs),
                });
                // Drain body so the connection releases cleanly.
                try {
                    await res.text();
                } catch {
                    /* ignore */
                }
                return res.status;
            } catch {
                return null;
            }
        };

        // Backoff schedule for polling. Caps individual sleeps so we never
        // overshoot timeoutMs by much.
        const sleep = (ms: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, ms));

        let attempt = 0;
        let readinessSignal: "http" | "stdout" | "none" = "none";
        let httpStatus: number | null = null;


        //time of waiting
        while (Date.now() - started < timeoutMs) {
            // Process died before becoming ready.
            if (handle.exitCode !== undefined) {
                return {
                    pid,
                    ready: false,
                    url,
                    port,
                    elapsedMs: Date.now() - started,
                    readinessSignal: "none" as const,
                    httpStatus: null,
                    stdoutTail: tail(handle.stdout),
                    stderrTail: tail(handle.stderr),
                    exited: true,
                    exitCode: handle.exitCode ?? null,
                    reason: `process exited with code ${handle.exitCode} before becoming ready`,
                };
            }

            // Stdout signal
            if (matchesStdout()) {
                readinessSignal = "stdout";
                // Confirm with a quick HTTP probe so we don't return on a
                // banner-only line. Don't fail the whole call if probe misses.
                httpStatus = await probeHttp(2000);
                if (httpStatus !== null) readinessSignal = "http";
                break;
            }

            // HTTP signal
            httpStatus = await probeHttp(1500);
            if (httpStatus !== null) {
                readinessSignal = "http";
                break;
            }

            attempt += 1;
            // Backoff: 500ms, 1s, 1.5s, 2s, 2s, 2s, ...
            const delay = Math.min(500 + attempt * 500, 2000);
            const remaining = timeoutMs - (Date.now() - started);
            if (remaining <= 0) break;
            await sleep(Math.min(delay, remaining));
        }

        const ready = readinessSignal !== "none";
        return {
            pid,
            ready,
            url,
            port,
            elapsedMs: Date.now() - started,
            readinessSignal,
            httpStatus,
            stdoutTail: tail(handle.stdout),
            stderrTail: tail(handle.stderr),
            exited: handle.exitCode !== undefined,
            exitCode: handle.exitCode ?? null,
            reason: ready
                ? null
                : `timed out after ${timeoutMs}ms; process is still running with PID ${pid} — kill it with taskkill /F /T /PID ${pid} when done`,
        };
    },
});
