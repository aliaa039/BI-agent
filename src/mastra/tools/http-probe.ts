import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Lightweight HTTP probe. Replaces shelling out to curl for liveness checks.
 *
 * Returns quickly on connection failure (no waiting for full command timeout)
 * and gives structured fields the model can branch on.
 */
export const httpProbeTool = createTool({
    id: "http_probe",
    description:
        "Probe an HTTP(S) URL and return its status code and timing. Use this to verify a dev/preview server is actually serving (e.g. http://localhost:3000/) instead of shelling out to curl. Fails fast on connection refused.",
    inputSchema: z.object({
        url: z
            .string()
            .url()
            .describe("Full URL to probe, e.g. http://localhost:3000/"),
        method: z
            .enum(["GET", "HEAD"])
            .optional()
            .default("GET")
            .describe("HTTP method (default GET)"),
        timeoutMs: z
            .number()
            .int()
            .positive()
            .optional()
            .default(5000)
            .describe("Per-request timeout in milliseconds (default 5000)"),
    }),
    outputSchema: z.object({
        ok: z.boolean(),
        status: z.number().nullable(),
        statusText: z.string().nullable(),
        elapsedMs: z.number(),
        bodyPreview: z.string().nullable(),
        error: z.string().nullable(),
    }),
    execute: async (input) => {
        const url = input.url;
        const method = input.method ?? "GET";
        const timeoutMs = input.timeoutMs ?? 5000;
        const started = Date.now();
        try {
            const res = await fetch(url, {
                method,
                signal: AbortSignal.timeout(timeoutMs),
            });
            const elapsedMs = Date.now() - started;
            let bodyPreview: string | null = null;
            if (method === "GET") {
                try {
                    const text = await res.text();
                    bodyPreview = text.slice(0, 500);
                } catch {
                    /* body unreadable, ignore */
                }
            }
            return {
                ok: res.ok,
                status: res.status,
                statusText: res.statusText,
                elapsedMs,
                bodyPreview,
                error: null,
            };
        } catch (err) {
            const elapsedMs = Date.now() - started;
            return {
                ok: false,
                status: null,
                statusText: null,
                elapsedMs,
                bodyPreview: null,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    },
});
