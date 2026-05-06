/**
 * Smoke test for the model wiring used by this project.
 *
 * Reads the project's actual env vars:
 *   AZURE_RESOURCE_NAME, AZURE_API_KEY, AZURE_API_VERSION, AZURE_CHAT_DEPLOYMENT
 *
 * Tests BOTH providers side-by-side so you can compare reliability:
 *   1. openai-sdk — current path (`@ai-sdk/openai` pointed at Azure via baseURL)
 *   2. azure-sdk  — supported path (`@ai-sdk/azure`, purpose-built)
 *
 * Each provider runs N agent invocations that MUST drive a tool call, so we
 * verify model + transport + tool-calling protocol — not just an HTTP ping.
 *
 * Run:
 *   bun run scripts/smoke-openai.ts
 *   N=20 ONLY=azure bun run scripts/smoke-openai.ts
 *
 * Exits 1 if any provider has failures or any success skipped the tool call.
 */

import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

// --- openai-sdk provider pointed at Azure's v1 endpoint --------------------
// Azure exposes an OpenAI-compatible v1 endpoint:
//   https://<resource>.openai.azure.com/openai/v1
// which accepts the standard `Authorization: Bearer <key>` header that
// @ai-sdk/openai sends.
//
// IMPORTANT: do NOT bake `api-version` into baseURL — the SDK appends the
// route ('/responses', '/chat/completions', ...) AFTER baseURL verbatim,
// so a query string in baseURL produces malformed URLs like
//   /openai/v1?api-version=preview/responses
// Instead, inject api-version through a custom `fetch` wrapper.
const RESOURCE = Bun.env.AZURE_RESOURCE_NAME ?? '';
const API_KEY = Bun.env.AZURE_API_KEY ?? '';
const API_VERSION = Bun.env.AZURE_API_VERSION ?? 'preview';
const DEPLOYMENT = Bun.env.AZURE_CHAT_DEPLOYMENT ?? 'gpt-5.4-1';

const azureFetch: typeof fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  if (!url.searchParams.has('api-version')) {
    url.searchParams.set('api-version', API_VERSION);
  }
  return fetch(url.toString(), init);
};

const openaiProvider = createOpenAI({
  apiKey: API_KEY,
  baseURL: `https://${RESOURCE}.openai.azure.com/openai/v1`,
  fetch: azureFetch,
});

type ProviderName = 'openai-sdk' | 'azure-sdk';

type CallResult =
  | { ok: true; ms: number; toolCalled: boolean; text: string }
  | { ok: false; ms: number; error: string; status?: number; body?: string };

const N = Number(Bun.env.N ?? 5);
const TIMEOUT_MS = Number(Bun.env.TIMEOUT_MS ?? 20_000);
const ONLY = (Bun.env.ONLY ?? '').toLowerCase();

// --- Tool the agent MUST call ----------------------------------------------
const toolHits: Record<ProviderName, number> = {
  'openai-sdk': 0,
  'azure-sdk': 0,
};

function makePingTool(provider: ProviderName) {
  return createTool({
    id: 'ping',
    description:
      'Returns a server-side pong token. You MUST call this tool to answer the user.',
    inputSchema: z.object({
      nonce: z.string().describe('Any short string echoed back in the response.'),
    }),
    outputSchema: z.object({ pong: z.string(), nonce: z.string() }),
    execute: async ({ context }) => {
      toolHits[provider]++;
      return { pong: 'pong', nonce: context.nonce };
    },
  });
}

const SHARED_INSTRUCTIONS =
  'You are a smoke-test agent. To answer ANY user message you MUST call the `ping` tool exactly once with a short nonce, then reply with the word it returns.';

async function buildAgents(): Promise<Partial<Record<ProviderName, Agent>>> {
  const agents: Partial<Record<ProviderName, Agent>> = {};

  if (!ONLY || ONLY === 'openai' || ONLY === 'openai-sdk') {
    agents['openai-sdk'] = new Agent({
      name: 'smoke-openai-sdk',
      instructions: SHARED_INSTRUCTIONS,
      model: openaiProvider(DEPLOYMENT),
      tools: { ping: makePingTool('openai-sdk') },
    });
  }

  if (!ONLY || ONLY === 'azure' || ONLY === 'azure-sdk') {
    try {
      const { createAzure } = await import('@ai-sdk/azure');
      const azure = createAzure({
        resourceName: RESOURCE,
        apiKey: API_KEY,
        apiVersion: API_VERSION,
      });
      agents['azure-sdk'] = new Agent({
        name: 'smoke-azure-sdk',
        instructions: SHARED_INSTRUCTIONS,
        model: azure(DEPLOYMENT),
        tools: { ping: makePingTool('azure-sdk') },
      });
    } catch (err) {
      console.warn(
        'azure-sdk skipped: @ai-sdk/azure not installed. `bun add @ai-sdk/azure`',
      );
      void err;
    }
  }

  return agents;
}

// --- Helpers ---------------------------------------------------------------
function checkEnv(): string[] {
  const w: string[] = [];
  if (!RESOURCE) w.push('AZURE_RESOURCE_NAME is unset');
  if (!API_KEY) w.push('AZURE_API_KEY is unset');
  if (!API_VERSION) w.push('AZURE_API_VERSION is unset');
  if (!DEPLOYMENT) w.push('AZURE_CHAT_DEPLOYMENT is unset');
  return w;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function extractDiagnostics(err: unknown): {
  status?: number;
  body?: string;
  message: string;
} {
  const e = err as Record<string, unknown> | undefined;
  const message = e?.message ? String(e.message) : String(err);
  const status =
    typeof e?.statusCode === 'number'
      ? (e.statusCode as number)
      : typeof e?.status === 'number'
        ? (e.status as number)
        : undefined;
  const body =
    typeof e?.responseBody === 'string'
      ? (e.responseBody as string)
      : typeof e?.data === 'string'
        ? (e.data as string)
        : e?.data
          ? JSON.stringify(e.data).slice(0, 500)
          : undefined;
  return { status, body, message };
}

function classify(r: Extract<CallResult, { ok: false }>): string {
  if (r.error.startsWith('timeout')) return 'TIMEOUT';
  if (r.status === 401 || r.status === 403) return 'AUTH';
  if (r.status === 404) return 'URL/DEPLOYMENT';
  if (r.status === 400 && /api-version/i.test(r.body ?? '')) return 'API-VERSION';
  if (r.status === 429) return 'RATE-LIMIT';
  if (r.status && r.status >= 500) return 'AZURE-5XX';
  return 'OTHER';
}

async function callOnce(provider: ProviderName, agent: Agent, i: number): Promise<CallResult> {
  const started = Date.now();
  const before = toolHits[provider];
  try {
    const result = await withTimeout(
      agent.generate(`Run #${i}: please ping with nonce "n${i}".`, {
        maxSteps: 3,
        maxRetries: 0,
      } as Parameters<typeof agent.generate>[1]),
      TIMEOUT_MS,
    );
    const toolCalled = toolHits[provider] > before;
    const text = (result as { text?: string }).text?.trim() ?? '';
    return { ok: true, ms: Date.now() - started, toolCalled, text };
  } catch (err) {
    const { status, body, message } = extractDiagnostics(err);
    return {
      ok: false,
      ms: Date.now() - started,
      error: message,
      status,
      body: body?.slice(0, 300),
    };
  }
}

async function runProvider(provider: ProviderName, agent: Agent): Promise<CallResult[]> {
  const results: CallResult[] = [];
  console.log(`\n=== ${provider} (${N} runs) ===`);
  for (let i = 1; i <= N; i++) {
    const r = await callOnce(provider, agent, i);
    results.push(r);
    if (r.ok) {
      const tag = r.toolCalled ? 'OK' : 'OK-NO-TOOL';
      console.log(`  [${i}/${N}] ${tag}  ${r.ms}ms  ← ${JSON.stringify(r.text)}`);
    } else {
      const tag = classify(r);
      console.log(
        `  [${i}/${N}] FAIL ${r.ms}ms  [${tag}${r.status ? ' ' + r.status : ''}] ${r.error}` +
          (r.body ? `\n        body: ${r.body}` : ''),
      );
    }
  }
  return results;
}

function summarize(provider: ProviderName, results: CallResult[]) {
  const ok = results.filter((r) => r.ok) as Extract<CallResult, { ok: true }>[];
  const okWithTool = ok.filter((r) => r.toolCalled);
  const fail = results.filter((r) => !r.ok) as Extract<CallResult, { ok: false }>[];
  const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q: number) =>
    lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : 0;

  console.log(`\n--- ${provider} summary ---`);
  console.log(`  success:        ${ok.length}/${results.length}`);
  console.log(`  with tool call: ${okWithTool.length}/${results.length}`);
  console.log(`  failure:        ${fail.length}/${results.length}`);
  if (lat.length) {
    console.log(`  latency p50/p95/max: ${p(0.5)}ms / ${p(0.95)}ms / ${lat.at(-1)}ms`);
  }
  if (fail.length) {
    const buckets = new Map<string, number>();
    for (const f of fail) buckets.set(classify(f), (buckets.get(classify(f)) ?? 0) + 1);
    console.log('  failure breakdown:');
    for (const [k, v] of buckets) console.log(`    ${k}: ${v}`);
  }

  return { failed: fail.length, missingTool: ok.length - okWithTool.length };
}

async function main() {
  console.log(
    `smoke: N=${N}, timeout=${TIMEOUT_MS}ms, deployment=${DEPLOYMENT}, api-version=${API_VERSION}, resource=${RESOURCE}` +
      (ONLY ? `, only=${ONLY}` : ''),
  );

  const warnings = checkEnv();
  if (warnings.length) {
    console.log('\nenv warnings:');
    for (const w of warnings) console.log(`  - ${w}`);
  }

  const agents = await buildAgents();
  const totals = { failed: 0, missingTool: 0 };

  for (const provider of ['openai-sdk', 'azure-sdk'] as const) {
    const agent = agents[provider];
    if (!agent) continue;
    const results = await runProvider(provider, agent);
    const s = summarize(provider, results);
    totals.failed += s.failed;
    totals.missingTool += s.missingTool;
  }

  process.exit(totals.failed || totals.missingTool ? 1 : 0);
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exit(2);
});
