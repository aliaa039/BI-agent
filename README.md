# BI Agent

This repository is a Mastra-based project for building an internal BI dashboard generation agent that uses Evidence as the dashboard compiler.

The intended product shape is:

- the user interacts through Mastra Studio chat
- the system accepts a Google Sheets URL or uploaded CSV
- the system profiles the data, plans a dashboard, generates an Evidence project, validates the build, and returns a preview URL or build artifact

## Current Status

The repository is still in an early setup phase.

Implemented now:

- a working Mastra runtime in `src/mastra`
- local storage and observability setup for Mastra Studio
- an OpenAI model factory in `src/mastra/models/openai.ts`
- a separate `dashboard-workspace/dashboard-app` area for manual Evidence testing

Not implemented yet:

- dashboard-specific agents
- dashboard generation tools
- profiling, planning, build, and validation workflows
- a shared Mastra Workspace layer for Evidence project generation

That distinction matters because the diagram below shows the target agent flow, not the current runtime-only scaffold.

## Agent Flow Diagram

```text
User in Mastra Studio chat
	|
	v
Input: Google Sheets / CSV / MCP source
	|
	v
Profile: Inspect schema & metrics
	|
	v
Plan: Dashboard structure
	|
	v
Build: Mastra Workspace (files, commands, skills)
	|
	v
Evidence project
	|
	v
Validate: npm run sources & build
	|
	v
Success?
	|
	+--> No: patch & retry -> Build stage
	|
	+--> Yes: return preview URL or build output
```

## Architecture Summary

The target system treats Evidence as the rendering and static build layer, not as the reasoning layer. Mastra handles orchestration, model access, storage, observability, and eventually the agent and workflow logic. A shared workspace should sit between the dashboard workflow and the generated Evidence project so the build and validation stages can operate on the same files and command environment.

The intended execution flow is:

1. Profile the input data from a Google Sheet, CSV upload, or MCP-backed source.
2. Produce a dashboard plan from the real schema and sample values.
3. Generate or update an Evidence project on disk.
4. Run source extraction and build commands locally.
5. Patch and retry when SQL, schema, or page errors are fixable.
6. Return a local preview URL, static build path, or exportable project.

## Current Runtime Flow

The code that exists today is much simpler than the target architecture:

```text
Mastra Studio
	|
	v
src/mastra/index.ts
	|
	+--> Composite storage
	|       |
	|       +--> LibSQL runtime store
	|       |
	|       +--> DuckDB observability store
	|
	+--> Observability exporters and filters
	|
	+--> Future agents, tools, workflows
```

Today, `src/mastra/index.ts` initializes the Mastra runtime, creates the `.mastra` state directory, configures composite storage, and enables observability exporters. It does not yet register any project-specific agents or workflows.

## Repository Shape

- `src/mastra`: Mastra runtime, future agents, tools, and workflows
- `src/mastra/models`: model provider setup
- `dashboard-workspace/dashboard-app`: local Evidence sandbox and generated dashboard target
- `docs`: planning notes, including the target dashboard-agent architecture

## Run Mastra

Start Mastra Studio from the repository root:

```shell
npm run dev
```

Mastra Studio runs at `http://localhost:4111`.

To verify the project compiles:

```shell
npm run build
```

## Test Evidence Separately

Use `dashboard-workspace/dashboard-app` for manual Evidence experiments while the Mastra-side agent flow is still being built.

Typical local flow:

```shell
cd dashboard-workspace/dashboard-app
npm install
npm run sources
npm run dev
```

For a production build:

```shell
npm run build
```

## Target Internal Agent Shape

The planned central tool-agent is `evidence_dashboard_agent`.

Its responsibilities are expected to include:

- profile input data
- generate a dashboard plan
- create or update an Evidence project
- write dashboard pages and source files
- run local Evidence commands
- validate build output
- patch and retry on fixable failures

The workflow should be staged rather than handled by one large prompt:

1. Profile stage
2. Plan stage
3. Build stage
4. Validation and repair loop

## Recommended Next Implementation Steps

1. Add a shared workspace abstraction for the dashboard build job.
2. Create a profiling tool for CSV and Google Sheets inputs.
3. Add a planning workflow that turns the profile into a dashboard spec.
4. Add build and validation tools that operate on `dashboard-workspace/dashboard-app`.
5. Register the first dashboard agent and workflow in `src/mastra/index.ts`.

## Reference

The target architecture described in this README is based on the planning document in `docs/Evidence dashboard agent project shape.md`.