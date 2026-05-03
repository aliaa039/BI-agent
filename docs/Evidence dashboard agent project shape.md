# Evidence Dashboard Agent Project Shape

## Purpose

Build a standalone internal BI dashboard generation project that runs locally on a developer machine or a local worker.

The final shape is not a live BI product with a manual UI. It is a code-driven dashboard generation system where agents inspect data, generate an Evidence project, build the dashboard locally, and return a local preview URL or exportable build.

## Core Idea

Treat Evidence as a dashboard and report compiler, not as the main reasoning layer.

The system should use:

```text
Google Sheets URL or direct CSV as the primary data input
Evidence for dashboard rendering and static site generation
Mastra Workspace for local execution, file access, and reusable skills
An internal workflow controller for staged execution
```

The cleanest architecture is:

```text
The system reasons over data from a shared Google Sheet, a direct CSV file, or an MCP-backed source.
The system publishes dashboards with Evidence.
Mastra Workspace executes the local workflow.
An internal workflow controller manages the stages.
```

## Where Mastra Workspace Fits

Mastra Workspace should be the local execution layer inside the standalone project.

It fits between the dashboard workflow logic and the generated Evidence project:

```text
Dashboard workflow
    -> Mastra Workspace
        -> local files
        -> shell commands
        -> reusable skills
        -> generated Evidence project
```

This is the cleanest place to use Mastra because the project already needs:

```text
- local filesystem access
- command execution for npm and Evidence
- safe project editing
- reusable instructions for dashboard generation and validation
```

Mastra Workspace should not replace Evidence.
It should provide the execution environment around Evidence.

## Final System Shape

```text
Dashboard generation workflow
    -> Profile data
    -> Build Evidence project
    -> Validate and repair
        -> Local preview URL or built artifact
```

Expanded flow:

```text
User request
    -> Profile stage: inspect Google Sheet or CSV and define metrics
    -> Build stage: use Mastra Workspace to generate Evidence project files
    -> Validation stage: use Mastra Workspace to run build, catch SQL or component errors, patch and retry
    -> Return local preview URL, static build, or project export
```

## Main Internal Tool-Agent

The central internal tool-agent should be:

```text
evidence_dashboard_agent
```

Its responsibility is to turn structured data inputs and dashboard goals into a working Evidence project and a locally previewable artifact.

### Recommended actions

```text
profile_input_data
generate_dashboard_plan
create_evidence_project
write_evidence_page
read_workspace_file
search_workspace_content
execute_workspace_command
run_sources
run_build
start_preview
export_project
```

## Mastra Workspace Responsibilities

Mastra Workspace should provide the shared execution surface used by the build and validation stages.

Recommended workspace capabilities:

```text
- LocalFilesystem for project files
- LocalSandbox for local command execution
- skills for reusable dashboard-generation instructions
- optional LSP inspection for code-aware edits
```

Recommended workspace role in this project:

```text
- create and edit the Evidence project on disk
- run npm install, npm run sources, npm run build, and npm run dev
- inspect generated files before patching them
- expose reusable skills such as evidence-page-authoring and build-validator
```

## Workflow Responsibilities

### 1. Profile Stage

Responsibilities:

```text
- read a shared Google Sheets URL or direct CSV file
- inspect schema and sample rows
- identify dimensions and metrics
- write or validate SQL
- define the dashboard plan
```

This stage should work against real data first so the build stage does not hallucinate fields or charts.

### 2. Build Stage

Responsibilities:

```text
- create the Evidence project
- add sources and queries
- write Markdown dashboard pages
- add charts, tables, and filters
- use Mastra Workspace file tools to create and edit project files
- use Mastra Workspace command execution to initialize and run Evidence
- run the Evidence build pipeline
```

### 3. Validation Stage

Responsibilities:

```text
- run the build
- detect SQL errors
- detect wrong column names
- detect component or syntax errors
- inspect workspace files before patching
- rerun local commands through Mastra Workspace
- patch files and retry
```

This validation loop is a required part of the final shape, not an optional extra.

## Execution Model

The system should not rely on one giant prompt. It should run the dashboard workflow in three phases.

### Phase 1. Profile

The system inspects the input data and produces a structured understanding of the dataset.

Expected checks:

```text
- columns
- types
- missing values
- date columns
- candidate metrics
- candidate dimensions
- row count
- sample values
```

Example output:

```json
{
    "tables": [
        {
            "name": "sales_data",
            "columns": [
                { "name": "order_date", "type": "date" },
                { "name": "revenue", "type": "number" },
                { "name": "region", "type": "string" }
            ]
        }
    ],
    "suggested_metrics": ["revenue", "orders", "avg_order_value"],
    "suggested_dimensions": ["region", "product", "channel"]
}
```

### Phase 2. Plan

The system proposes the dashboard structure before generating files.

Example output:

```json
{
    "pages": [
        {
            "path": "pages/index.md",
            "title": "Sales Overview",
            "sections": [
                "KPI cards",
                "Revenue trend",
                "Revenue by region",
                "Top products",
                "Raw data table"
            ]
        }
    ]
}
```

### Phase 3. Build

The system writes the Evidence files, runs the source extraction step, builds the site locally, and returns the artifact.

This phase should execute inside Mastra Workspace so the same agent environment can:

```text
- write files
- run commands
- inspect failures
- patch and retry
```

Build commands:

```bash
npm run sources
npm run build
```

## Local Runtime Contract

The local runtime should provide:

```text
Node.js 18+
npm
Evidence package
Ability to read a shared Google Sheets URL or local CSV file
Ability to run a local preview server
Artifact export support
Mastra Workspace with LocalFilesystem and LocalSandbox
```

Recommended Mastra Workspace configuration:

```ts
import {
    Workspace,
    LocalFilesystem,
    LocalSandbox,
} from "@mastra/core/workspace";

export const dashboardWorkspace = new Workspace({
    filesystem: new LocalFilesystem({
        basePath: "./dashboard-workspace",
    }),
    sandbox: new LocalSandbox({
        workingDirectory: "./dashboard-workspace",
    }),
    skills: ["skills"],
    lsp: true,
});
```

## Recommended Stack

Use this stack as the default implementation:

```text
Evidence
+ Google Sheets URL or CSV file
+ Mastra Workspace
+ Git or artifact storage
```

This means:

```text
Google Sheets URL or CSV file
    -> input profiling and metric planning
    -> Mastra Workspace file and command execution
  -> Evidence project generation
  -> Built dashboard artifact
```

## Project Structure on Local Disk

The generated project should look roughly like this on disk:

```text
dashboard-app/
  pages/
    index.md
  sources/
        sales_data/
      connection.yaml
            source_reference.json
      orders.sql
  evidence.config.yaml
  package.json

dashboard-workspace/
    dashboard-app/
    skills/
        evidence-page-authoring/
            SKILL.md
        evidence-build-validator/
            SKILL.md
```

## Build and Preview Flow

Typical local flow:

```bash
mkdir dashboard-app
cd dashboard-app
npm create evidence@latest .
npm install
npm run sources
npm run build
```

Typical Mastra Workspace flow:

```bash
mkdir dashboard-workspace
cd dashboard-workspace
mkdir skills
mkdir dashboard-app
cd dashboard-app
npm create evidence@latest .
npm install
npm run sources
npm run build
```

For preview during execution:

```bash
npm run dev
```

For final delivery:

```bash
npm run build
```

## Input and Output Contract

### Example input

```json
{
    "task": "Create an interactive sales dashboard",
    "google_sheet_url": "https://docs.google.com/spreadsheets/d/your-sheet-id/edit",
    "csv_path": "C:/data/sales.csv",
    "goal": "Show revenue, margin, top products, trends, filters",
    "output": "evidence_project"
}
```

### Example output

```json
{
    "status": "success",
    "project_path": "C:/work/evidence-app",
    "preview_url": "http://localhost:3000",
    "build_path": "C:/work/evidence-app/build",
    "files_created": [
        "pages/index.md",
        "sources/sales_data/connection.yaml",
        "sources/sales_data/orders.sql"
    ]
}
```

## MCP Placement

There are two valid MCP integration points.

### Option A. MCP for data access

This is the stronger option.

```text
Agent
  -> MCP data server
        -> Google Sheets or CSV or Postgres or MotherDuck
  -> Evidence files generated from query results
```

Useful MCP capabilities:

```text
list_tables
describe_table
sample_rows
run_sql
profile_column
```

### Option B. MCP for Evidence project operations

This exposes project-building actions directly as tools.

```text
create_project
add_google_sheet_source
add_csv_source
write_page
write_query
run_sources
run_build
start_preview
return_artifact
```

This option fits well when the project already models dashboard operations as explicit tool actions.

Mastra Workspace fits underneath this option well because those actions can be implemented as workspace-backed operations over files and commands.

## Mastra Integration Shape

The cleanest implementation is:

```text
Dashboard workflow
    -> profile stage
    -> build stage
    -> validation stage

Build stage + validation stage
    -> shared Mastra Workspace
            -> LocalFilesystem
            -> LocalSandbox
            -> skills
            -> optional LSP inspection
```

In Mastra terms, the workspace should be attached either:

```text
- globally on the Mastra instance if multiple workflow stages share the same project workspace
- or directly on the build and validation components if you want tighter isolation
```

Preferred choice for this project:

```text
Use one shared workspace for the dashboard build job so the build and validation stages operate on the same files and command environment.
```

Example shape:

```ts
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import {
    Workspace,
    LocalFilesystem,
    LocalSandbox,
} from "@mastra/core/workspace";

const workspace = new Workspace({
    filesystem: new LocalFilesystem({ basePath: "./dashboard-workspace" }),
    sandbox: new LocalSandbox({ workingDirectory: "./dashboard-workspace" }),
    skills: ["skills"],
    lsp: true,
});

export const dashboardBuilderAgent = new Agent({
    id: "dashboard-builder",
    model: "openai/gpt-5.4",
    workspace,
});

export const validatorAgent = new Agent({
    id: "dashboard-validator",
    model: "openai/gpt-5.4",
    workspace,
});

export const mastra = new Mastra({
    workspace,
    agents: {
        dashboardBuilderAgent,
        validatorAgent,
    },
});
```

This can still be implemented with Mastra agents internally, but the product itself should be framed as one standalone dashboard generation project rather than a multi-agent platform.

## Tool Schema Shape

Example tool schema:

```json
{
    "name": "build_evidence_dashboard",
    "description": "Create an Evidence BI dashboard from a Google Sheets URL, CSV file, or SQL source",
    "input_schema": {
        "type": "object",
        "properties": {
            "task": { "type": "string" },
            "google_sheet_url": {
                "type": "string"
            },
            "csv_path": {
                "type": "string"
            },
            "dashboard_style": {
                "type": "string",
                "enum": ["executive", "exploratory", "operational"]
            },
            "output_format": {
                "type": "string",
                "enum": ["preview_url", "static_build", "project_zip"]
            }
        },
        "required": ["task"]
    }
}
```

At least one of `google_sheet_url` or `csv_path` should be provided.

## Recommended Data Pattern

Do not let Evidence infer everything directly from a raw shared sheet or raw CSV file.

Preferred pattern:

```text
Google Sheets URL or CSV file
    -> input profiling
    -> normalized queries or generated SQL
  -> Evidence dashboard
```

This reduces hallucination and makes the generated dashboard more reliable.

Useful inspection outputs:

```text
- sheet tabs or CSV headers
- header row
- sample rows
- inferred column types
- missing values
- candidate metrics and dimensions
```

## Minimal Deliverable

The minimum successful project outcome is:

```text
- one internal evidence_dashboard_agent
- one working Google-Sheet-to-dashboard or CSV-to-dashboard flow
- one Mastra Workspace layer for local files, commands, and reusable skills
- one locally previewable Evidence dashboard artifact
- one validator loop that can catch and repair common build failures
```

## Final Recommendation

The final project should be framed as:

```text
Build a standalone internal Evidence-based dashboard generation project.
It should accept BI tasks driven by a shared Google Sheets URL or a direct CSV file, reason over that data or MCP-backed sources, use Mastra Workspace for local file access, command execution, and reusable skills, generate an Evidence project on local disk, validate the build, and return a locally previewable dashboard artifact.
```
