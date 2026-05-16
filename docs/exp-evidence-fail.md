Absolutely — here’s a concise retrospective.

## What I did (timeline)

1. **Started dev server** (`npm run dev`) and confirmed it was serving on `:3000`.
2. You reported catalog errors (`customers.customers` not found).
3. I inspected:
   - `sources/customers/connection.yaml`
   - `sources/customers/customers.sql`
   - `pages/index.md`
4. I changed source type to CSV and changed page queries to `customers.customers_100`.
5. Ran `npm run sources` successfully, but runtime still errored (`customers_100` not found).
6. Re-checked with `--debug`; output showed schema `customers` and query/table `customers`.
7. Updated page back to `from customers.customers`.
8. You still saw errors; we then did a **full reset flow**:
   - killed dev server
   - attempted cache cleanup
   - restored deterministic DuckDB source (`name: customers`, `type: duckdb`)
   - rewrote `customers.sql`
   - rebuilt sources
   - restarted dev server
9. During kill output, a hidden root issue surfaced: **CSV sniffing/parsing failure** for `customers_100.csv`.
10. Final fix: made `read_csv(...)` explicit with parsing options (`delim`, `quote`, `escape`, `strict_mode=false`, `ignore_errors=true`), rebuilt, restart succeeded.

---

## Problems encountered

1. **Table name confusion**
   - `customers.customers` vs `customers.customers_100`
   - This bounced because Evidence naming differs by source mode (csv plugin vs duckdb/sql query model).

2. **Stale runtime/caching symptoms**
   - UI kept showing old errors even after edits/rebuilds.

3. **Critical hidden issue**
   - CSV dialect auto-detection failed:
     - `Invalid Input Error ... not possible to automatically detect CSV parsing dialect`
   - This caused source materialization instability and misleading downstream table-not-found signals.

4. **Partial cache deletion lock**
   - `.evidence` delete returned `EBUSY` once; common right after process stop.

---

## Fixes that failed / were incomplete

- Switching to `type: csv` + querying `customers.customers_100` did not resolve.
- Query-name-only edits (without solving CSV parse error) were insufficient.
- Assuming table name from filename or from prior behavior was not reliable enough alone.

---

## Final fix that worked

- Use deterministic DuckDB source:
  - `connection.yaml`:
    - `name: customers`
    - `type: duckdb`
- Use `customers.sql` as the canonical source query
- Explicit CSV parsing options in `read_csv(...)` to bypass sniffing failure
- Rebuild sources + restart dev server

This removed the root ingestion instability and stabilized the model.

---

## What misled me?

Mostly **runtime signals**, not one single prompt.

### 1) Misleading signal from successful `npm run sources`
A success message suggested source health, while a CSV parsing issue was still present in dev logs. I should have forced a direct validation query or inspected more logs earlier.

### 2) Ambiguity in source mode
The workspace had both:
- CSV file in `sources/.../data`
- a `customers.sql`
- and mutable `connection.yaml`
This made it easy to flip mental models between csv-plugin naming and duckdb/sql naming.

### 3) Prompt/skill contribution
- **System/developer prompt** encouraged inspecting `.sql` and using `<source>.<table>` but didn’t enforce a *verification step* (e.g., list actual relations after source build).
- **Skill** wasn’t the primary issue; the bigger gap was missing “prove table exists” workflow before editing dashboards.

---

## Recommendations to improve prompts/instructions

### High-impact changes

1. **Add mandatory post-build verification step**
   After `npm run sources`, require one of:
   - query to list relations in target schema, or
   - Evidence metadata check that returns actual table names.
   Then use only verified names in dashboard SQL.

2. **Enforce single source mode per source directory**
   If `type: duckdb`, treat `.sql` files as canonical and ignore csv-plugin assumptions.
   If `type: csv`, avoid `.sql` table naming assumptions.
   Add a rule: “Do not switch source type mid-debug unless explicitly requested.”

3. **Add “ingestion health before query debugging” rule**
   If table-not-found repeats, first check for upstream CSV parse errors (delimiter/quote/encoding/sniffing), then naming.

4. **Add cache-reset playbook in prompt**
   Include exact sequence for stale-state issues:
   - stop dev
   - clear `.evidence` safely
   - run sources
   - start dev
   - hard refresh

5. **Require explicit read_csv options for uploaded CSVs (default-safe template)**
   Especially for user uploads where dialect can be messy.

### Nice-to-have

- A tool-guided command to introspect built catalog directly (e.g., “show tables in source schema”) would reduce guesswork dramatically.
- A short “Evidence naming matrix” in the skill:
  - `type: duckdb` + `foo.sql` => relation `foo`
  - `type: csv` => relation naming rules from file/config (and quoting behavior)

---

Great outcome — and fair question.  
Here’s a concise post-mortem.

## What I did (chronological)
1. **Inspected uploaded CSV** at `uploads/customers-100.csv`.
2. **Created Evidence source** `dashboard-app/sources/customers/`.
3. Added `connection.yaml` (initially `type: csv` only).
4. Copied CSV into source as `customers_100.csv`.
5. Wrote `pages/index.md` with KPIs, trend, geo charts, tables.
6. Ran `npm run sources`, fixed source config error, reran successfully.
7. Started dev server and shared preview URL.
8. Responded to runtime errors from your feedback until fully resolved.

---

## Problems I hit + fixes

### 1) `connection.yaml` validation error (`name` required)
- **Problem:** `npm run sources` failed because this project expects `name` in `connection.yaml`.
- **Fix:** updated to:
  ```yaml
  name: customers
  type: csv
  ```
- **Result:** sources built successfully.

### 2) Wrong table name (`customers.customers_100` vs actual `customers.customers`)
- **Problem:** dashboard SQL referenced file-based table naming; this project materialized table as `customers`.
- **First fix:** replaced all references with `customers.customers`.
- **Result:** table errors resolved.

### 3) Bar chart column binding errors (`'country' is not a column`, `'city' is not a column`)
- **Problem:** chart layer failed to bind expected field names.
- **Failed fix attempt:** added `swapXY=true` only — not enough.
- **Final fix that worked:**
  - changed SQL aliases to normalized names:
    - `country as category`, `count(*) as value`
    - `city as category`, `count(*) as value`
  - changed chart props to `x=category`, `y=value`.
- **Result:** charts rendered correctly.

---

## What misled me

### Main issue: **skill guidance vs this project’s actual behavior**
- The Evidence skill gives **general naming rules** (CSV filename → table name), which is often true.
- This project’s source pipeline produced table name `customers` (source-level naming behavior), not `customers_100`.
- I should have done a **hard verification query first and used that result immediately** before writing all page SQL references.

So this was **more skill/generalization mismatch with project-specific implementation**, not really system-prompt conflict.  
System prompt actually told me to verify table names; I partially complied, but too late in sequence.

---

## Recommendations to improve your prompts/skill

1. **Strengthen mandatory step ordering**
   - Require: run sources → verify exact table names → only then write page queries.
   - Make this a hard gate in instructions.

2. **Add project-specific note**
   - In this repo, CSV source may materialize as `<source>.<source>` rather than `<source>.<filename>`.
   - Explicitly say: “Never trust inferred CSV table names in this template.”

3. **Add chart compatibility guideline**
   - Recommend normalized aliases (`category`, `value`) for first-pass charts.
   - Avoid raw field names until confirmed in rendered dataset.

4. **Add a quick “validation query block” pattern**
   - e.g. always include:
     ```sql
     select * from source.table limit 5
     ```
   - Then build chart queries from those confirmed columns.

5. **Add “first-failure strategy”**
   - If chart says column missing, immediately alias query output to canonical names instead of tweaking component props first.
