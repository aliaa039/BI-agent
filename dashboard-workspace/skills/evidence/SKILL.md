---
name: evidence
description: Evidence is an open-source, code-driven BI framework that renders dashboards from Markdown + SQL
version: 1.0.0
tags:
  - bi
  - dashboard
  - data-visualization
  - sql
---

# Evidence Framework Skill

## Overview

Evidence is an open-source, **code-driven BI framework** that renders data products — reports, dashboards, decision-support tools — from **Markdown + SQL**. It is a developer-centric alternative to drag-and-drop BI tools.

**Docs**: https://docs.evidence.dev  
**GitHub**: https://github.com/evidence-dev/evidence

> **AGENT CONSTRAINT — NO UI INTERACTION**  
> This agent operates entirely through file creation, file editing, and CLI commands.  
> The Evidence settings UI (`localhost:3000/settings`) **must never be used**.  
> Every action — adding sources, configuring connections, writing pages — is done by writing files and running commands. This includes CSV sources: given a file path, produce the correct config files and copy the file; never ask the user to click anything.

---

## When This Skill Applies

Trigger this skill whenever the user asks you to:
- Scaffold or initialise a new Evidence project
- Create or modify an Evidence page (`.md` file)
- Write SQL queries for an Evidence markdown file
- Add charts, tables, or input components to a page
- Add a new data source — especially from a CSV file path
- Configure or update source connection files
- Run sources, dev server, or build
- Troubleshoot Evidence rendering or query errors

---

## Core Mental Model

```
Data Source (DB / CSV / API)
        │
        │  Files written by agent:
        │  sources/[name]/connection.yaml
        │  sources/[name]/*.sql  (for SQL DBs)
        │  sources/[name]/*.csv  (for CSV sources)
        │
        ↓  npm run sources
   Parquet cache (.evidence/template/static/data/)
        │
        ↓  npm run dev  /  npm run build
   Markdown pages  (pages/**/*.md)
     ├── ```sql query_name``` fences  →  named datasets
     └── <Components data={query_name} />  →  charts / tables
        │
        ↓
   Static BI website (localhost:3000 in dev)
```

Evidence pages are `.md` files that combine:
1. **Named SQL code fences** — query the Parquet cache using DuckDB SQL
2. **HTML-like components** — consume query results via props
3. **Svelte control flow** — `{#each}`, `{#if}/{:else}`, `{params.x}`

---

## Project Structure

```
my-evidence-project/
├── pages/                      # One .md file = one URL route
│   ├── index.md
│   ├── sales.md
│   └── customers/
│       ├── index.md
│       └── [customer].md       # Templated / dynamic route
├── sources/                    # One sub-folder per data source
│   ├── my_csv_source/
│   │   ├── connection.yaml     # Source type + options (agent writes this)
│   │   └── orders.csv          # CSV file copied here by agent
│   └── my_db/
│       ├── connection.yaml
│       └── orders.sql          # Source query → Parquet table
├── queries/                    # Reusable page-level SQL files
│   └── top_customers.sql
├── components/                 # Custom Svelte components (optional)
├── evidence.config.yaml
└── package.json
```

---

## Installation & Scaffolding (Code Only)

```bash
# Create a new Evidence project (no UI needed)
npx degit evidence-dev/template my-project
cd my-project
npm install
```

After install, the project is ready. No browser setup required.

---

## CLI Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server with hot reload (localhost:3000) |
| `npm run sources` | Extract all sources into Parquet cache |
| `npm run sources -- --changed` | Only re-run sources whose queries changed |
| `npm run sources -- --sources my_source` | Re-run one specific source |
| `npm run sources -- --sources my_source --queries q1,q2` | Re-run specific queries in a source |
| `npm run build` | Build static site for production |
| `npm run preview` | Preview the production build locally |

**Port override**: `npm run dev -- --port 4000`

**Increase memory for large sources** (Mac/Linux):
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run sources
```

---

## Adding Data Sources — Headless (No UI)

The Evidence settings UI is just a wizard that writes two files:
- `sources/[name]/connection.yaml` — source type and non-sensitive options
- `sources/[name]/connection.options.yaml` — sensitive credentials (base-64 encoded, gitignored)

**The agent writes these files directly.** Never instruct the user to open the settings page.

---

### CSV Source — Given a File Path

This is the primary CSV workflow. When the user provides a CSV file path, the agent completes all steps below without any UI interaction.

**Step 1 — Create the source folder and connection.yaml**

```yaml
# sources/my_csv_source/connection.yaml
name: my_csv_source
type: csv
```

The `name` field is **required** and must match the source folder name. No credentials needed.

**Step 2 — Copy the CSV into the source folder**

```bash
# The CSV file MUST live inside sources/[source_name]/
# Only letters, numbers, and underscores are allowed in source names and file names.

cp /path/to/user/file.csv sources/my_csv_source/file.csv

# If the original filename contains hyphens, spaces, or other special characters,
# rename it to snake_case when copying:
cp "/path/to/my data-file.csv" sources/my_csv_source/my_data_file.csv
```

> **CRITICAL**: Evidence does not support reading CSV files from arbitrary external paths. The agent must always `cp` (or `mv`) the file into `sources/[source_name]/` before running sources.

**Step 3 — Run sources**

```bash
npm run sources -- --sources my_csv_source
```

**Step 4 — Verify table name (MANDATORY)**

Do NOT assume the table name from the filename. The Evidence build system may materialize the table with a different name than the CSV filename. Run a verification query:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'my_csv_source'
```

Use only the verified `table_name` in page queries.

**Step 5 — Verify columns (MANDATORY)**

Before writing chart queries, confirm available columns:

```sql
select * from my_csv_source.verified_table_name limit 5
```

Use only confirmed column names in subsequent queries.

**Step 6 — Query it in pages**

Reference the source using `source_name.table_name` where both come from verification, not filename inference.

---

### SQL Database Sources

The agent writes `connection.yaml` directly. Sensitive values (passwords, tokens) go in environment variables — **never hardcoded in files**.

**PostgreSQL example:**

```yaml
# sources/my_pg/connection.yaml
name: my_pg
type: postgres
host: db.example.com
port: 5432
database: analytics
user: evidence_user
ssl: true
```

```bash
# .env  (gitignored — never commit this file)
EVIDENCE_SOURCE__my_pg__password=secret
```

**DuckDB local file example:**

```yaml
# sources/my_duck/connection.yaml
name: my_duck
type: duckdb
# The .db file must be stored inside sources/my_duck/
filename: my_duck/analytics.db
```

**Other supported types**: `bigquery`, `snowflake`, `redshift`, `mssql`, `mysql`, `sqlite`, `databricks`, `motherduck`, `trino`

**Production env var format** (case-sensitive):
```
EVIDENCE_SOURCE__[source_name]__[variable_name]=value
```

---

### Source Queries (SQL Databases Only)

For SQL database sources, add `.sql` files inside `sources/[name]/` to define which tables to extract. These run in the **native DB dialect** (not DuckDB):

```sql
-- sources/my_pg/orders.sql
-- This uses the database's own SQL dialect
select * from public.orders
where created_at >= '2024-01-01'
```

This creates a Parquet table queryable in pages as `my_pg.orders`.

CSV sources do **not** need source `.sql` files — the `.csv` file itself becomes the table automatically.

**Build-time variables in source queries:**

```bash
# .env
EVIDENCE_VAR__client_id=123
```
```sql
-- sources/my_pg/orders.sql
select * from orders where client_id = ${client_id}
```

---

## SQL Queries in Pages

### Inline Query (most common)

````markdown
```sql sales_by_category
select
  category,
  sum(sales) as sales
from my_csv_source.orders
group by 1
order by 2 desc
```
````

- The query name goes **immediately after** ` ```sql ` with no space between it and `sql`
- Page queries **always use DuckDB SQL dialect** regardless of the underlying source
- The query name becomes the dataset variable referenced in components

### Using a Query Result in a Component

```markdown
<LineChart data={sales_by_category} x=category y=sales />
```

### Query Chaining

````markdown
```sql base
select item, sum(sales) as sales from my_source.orders group by 1
```

```sql avg_sales
select avg(sales) as avg_sales from ${base}
```
````

Use `${other_query_name}` to compose queries. Page order does not matter. Circular references are detected at compile time and shown as errors.

> Note: Some SQL dialects (Postgres, MySQL) require sub-query aliases — `from ${base} as base`

### Query Parameters

From an input component:
```sql
select * from my_source.orders
where category = '${inputs.selected_category}'
```

From a URL parameter on a templated page:
```sql
select * from my_source.orders
where customer = '${params.customer}'
```

### SQL File Queries (Reusable Across Pages)

```sql
-- queries/top_customers.sql
select customer, sum(revenue) as revenue
from my_source.orders
group by 1
order by 2 desc
limit 10
```

Reference in page frontmatter:
```yaml
---
title: Dashboard
queries:
  - top_customers: top_customers.sql
  - region_summary: regions/summary.sql
---
```

Then use `top_customers` exactly like an inline query result.

---

## Page Frontmatter

```yaml
---
title: Sales Dashboard
description: Monthly revenue and order overview
queries:
  - top_customers: top_customers.sql
  - region_summary: regions/summary.sql
---
```

---

## Deployment

```bash
npm run build
# Output: .evidence/build/ — a standard static site
```

Deploy the build output to any static host: Vercel, Netlify, Cloudflare Pages, GitHub Pages, AWS Amplify, Azure Static Apps, Firebase, etc.

Set DB credentials as environment variables on the host. Never commit `.env` files or `connection.options.yaml`.

---

## Agent Rules — Must Follow Before Every Action

### General Rules

1. **Never reference or navigate the settings UI.** All config is done by writing files. `localhost:3000/settings` does not exist for this agent.
2. **Always name SQL queries.** The name goes directly after ` ```sql `, e.g. ` ```sql my_query `. Unnamed queries will not render.
3. **Page queries always use DuckDB SQL dialect** — not the native DB dialect. Source `.sql` files use the source's native dialect.
4. **Wrap query result variables in `{...}` in component props** — `data={my_query}`, not `data="my_query"`.
5. **String interpolations in SQL WHERE clauses need single quotes** — `where name = '${params.customer}'`.
6. **Run `npm run sources` after any change to source config or source SQL files** — pages will not reflect new data until sources have been re-extracted.
7. **Don't mix up source queries and page SQL file queries.** `sources/` extracts raw data into Parquet. `queries/` contains reusable page-level queries that run against the Parquet cache.
8. **Every input component must have a `name` prop.** That name is the key used in `${inputs.name}` inside queries.
9. **Avoid circular query references.** The compiler detects them and throws a compile-time error.
10. **Use selective source flags for speed.** `--sources my_source` or `--changed` avoids re-running every source unnecessarily.

### CSV Source Rules (Critical)

11. **The CSV file must be physically copied into `sources/[source_name]/`.** Evidence cannot read CSV files from arbitrary external paths. Always run a `cp` or `mv` as part of the setup.
12. **Source folder names and CSV filenames must use only `[a-z0-9_]` characters.** No hyphens, spaces, or dots except the `.csv` extension. Rename files when copying if needed.
13. **CSV sources need no `.sql` extraction files.** The `.csv` file itself becomes the table. Only SQL database sources require `.sql` files.
14. **`connection.yaml` for a CSV source requires `name` and `type: csv`.** Nothing else is required unless the file has a non-standard delimiter or date format.
15. **After copying a CSV and writing `connection.yaml`, always run `npm run sources -- --sources [name]`** before writing page queries against it.

### Database Source Rules

16. **Never hardcode passwords or tokens in `connection.yaml`.** Use the env var pattern: `EVIDENCE_SOURCE__[source_name]__[variable_name]`.
17. **Non-sensitive values** (host, port, database name, username, ssl flag) go in `connection.yaml`. **Sensitive values** (passwords, tokens) go in `.env` or platform environment variables.

### Naming Rules (Critical)

18. **Three naming layers exist — only the first two matter in SQL:**

| Layer | Example | Who decides |
|---|---|---|
| Source name (schema) | `customers` | `connection.yaml` `name` field |
| Table name | `customers` | Evidence build system |
| File name | `customers_100.csv` | Your filesystem |

**Never infer table names from CSV filenames.** The build system may materialize tables with names unrelated to the filename. Always verify via `information_schema.tables` after `npm run sources`.

### Troubleshooting Rules (Critical)

19. **MANDATORY verification gate:** After `npm run sources`, you MUST complete these steps before writing any dashboard SQL:
    1. Verify table names via `information_schema.tables`
    2. Verify columns via `select * from schema.table limit 5`
    3. ONLY THEN write page queries
    
    **Do not write any dashboard SQL until steps 1-2 are complete.** Verification queries are internal — do not include them in final pages.

20. **Ingestion health before query debugging:** If `table not found` repeats, check for CSV parse errors FIRST. Look for `not possible to automatically detect CSV parsing dialect` in dev output or `npm run sources` logs. If found, apply explicit `read_csv()` options (see Default-Safe CSV Template below).

21. **Single source mode rule:** Do not switch source type mid-debug unless explicitly requested. If `type: duckdb`, treat `.sql` files as canonical. If `type: csv`, avoid `.sql` table naming assumptions. Never mix both modes in the same source directory.

22. **Cache-reset playbook:** When stale-state issues occur (UI shows old errors after edits/rebuilds), follow this exact sequence:
    1. Kill dev server
    2. Wait 2 seconds
    3. Delete `.evidence/template/static/data/` (or `.evidence` folder if needed)
    4. Run `npm run sources`
    5. Restart dev server
    6. Hard refresh browser (Ctrl+Shift+R)

### Chart Compatibility Rules

23. **Use fixed standard aliases for chart queries:** `category`, `value`, `date`, `metric`. Do not use raw field names in chart props unless confirmed working.

24. **Chart query template:**
    ```sql
    select country as category, count(*) as value from source.table group by 1
    ```
    Then use `<BarChart data={query} x=category y=value />`.

25. **First-failure strategy:** If a chart reports a missing column, immediately rewrite the SQL with standard aliases. Do NOT try component prop tweaks (like `swapXY`) first.

---

## Evidence Naming Matrix

| Source Mode | Config | Table Name Rule | Example |
|---|---|---|---|
| `type: csv` | `name: customers`, `type: csv` | Verify via information_schema — may equal source name or differ | `sources/customers/customers_100.csv` → verify → `customers.customers` |
| `type: duckdb` + `query.sql` | `name: customers`, `type: duckdb` | `source_name.query` (SQL file name) | `sources/customers/customers.sql` → `customers.customers` |

**Key rules:**
- Source name (schema) = `connection.yaml` `name` field
- Table name = determined by Evidence build system — **always verify**
- Reference as `source_name.table_name` in page queries
- File name is irrelevant to SQL — never use it to construct queries

---

## Default-Safe CSV Template

For uploaded CSVs where dialect may be messy, use this explicit `read_csv()` template in a `.sql` file with `type: duckdb` source mode:

```sql
-- sources/source_name/source_name.sql
select * from read_csv('source_name/filename.csv',
  delim = ',',
  quote = '"',
  escape = '"',
  header = true,
  ignore_errors = true,
  strict_mode = false,
  all_varchar = true,
  sample_size = -1
)
```

This bypasses automatic CSV sniffing which can fail on ambiguous files. Cast columns as needed in page queries (e.g., `cast("Subscription Date" as date)`).

**When to use:**
- User-uploaded CSVs with unknown dialect
- CSVs that failed automatic detection
- CSVs with mixed data types in columns

**When NOT needed:**
- Clean CSVs with standard comma delimiters and consistent types — use `type: csv` mode instead

---

## Quick Scaffolding Templates

See `references/scaffolding-templates.md` for full templates.

### New CSV Source from a File Path (Minimal)

Given path `/home/user/data/sales_2024.csv`:

```bash
mkdir -p sources/sales_data
printf "name: sales_data\ntype: csv\n" > sources/sales_data/connection.yaml
cp /home/user/data/sales_2024.csv sources/sales_data/sales_2024.csv
npm run sources -- --sources sales_data
```

Then verify table name before querying.

### Minimal Dashboard Page (Minimal)

````markdown
---
title: Sales Overview
---

# Sales Overview

```sql daily_sales
select
  date_trunc('day', order_date) as date,
  sum(revenue) as value
from sales_data.verified_table
group by 1
order by 1
```

<Grid cols=2>
  <BigValue data={daily_sales} value=value title="Revenue" fmt=usd0 />
</Grid>

<LineChart data={daily_sales} x=date y=value title="Daily Revenue" />
````

---

## Components Reference

See `references/components.md` for full component documentation.
