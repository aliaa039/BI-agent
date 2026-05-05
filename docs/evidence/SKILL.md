---
name: evidence
description: "Evidence BI dashboard workflow guide. Covers installing dependencies, running sources, building, and previewing Evidence projects on Windows with Bun. USE FOR: build evidence dashboard, run evidence sources, refresh data, preview dashboard, evidence dev server, fix sqlite3 native binding errors. DO NOT USE FOR: writing markdown pages or SQL sources (those are Evidence-specific authoring tasks)."
metadata:
  version: "1.0.0"
---

# Evidence Dashboard Workflow

Evidence projects live under `dashboard-workspace/dashboard-app/` (or another folder containing an Evidence `package.json`). All commands below run from that directory.

## ⚠️ Critical: Use `npm` for installs, not `bun install`

Evidence depends on native modules (`sqlite3`, `@duckdb/node-bindings`) that ship as prebuilt binaries. Bun's installer sometimes skips the postinstall step that downloads the napi-v6 binding, which leads to runtime errors like:

```
Cannot find module '...\node_modules\sqlite3\lib\binding\napi-v6-win32-unknown-x64\node_sqlite3.node'
```

**Always run `npm install` inside the Evidence app folder.** You may still use `bun run <script>` to execute the Evidence CLI scripts afterwards — Bun is fine as a script runner; it's only the install step that's unreliable for native deps.

If you hit the missing-binding error on an existing install, recover with:

```bash
npm rebuild sqlite3 --build-from-source=false
```

This re-downloads the correct prebuilt binary without compiling from source.

## Standard workflow

Run from `dashboard-workspace/dashboard-app/`:

### 1. Install dependencies (first time, or after `package.json` changes)

```bash
npm install
```

### 2. Refresh sources (after editing anything under `sources/`)

```bash
bun run sources
# or: npm run sources
```

`sources` re-runs each connector, queries the source databases / files, and writes the resulting parquet + manifest into `.evidence/`. Skip this step if you only edited markdown pages or components.

### 3a. Production-style flow (build then preview)

Use this when you want to validate what end users will see:

```bash
bun run build
bun run preview
```

- `build` produces a static `build/` directory.
- `preview` serves that static build locally.
- After this flow, **do not** run `dev` against the same data without rerunning `sources` if data changed.

### 3b. Development flow (live reload)

Use this while authoring pages and iterating quickly:

```bash
bun run dev
```

`dev` watches markdown pages and hot-reloads. **Do not run `build` or `preview` while `dev` is active** — they share the same `.evidence/` workspace and conflict. Stop `dev` first if you need to produce a build.

## Decision matrix

| Goal                                  | Commands                                  |
| ------------------------------------- | ----------------------------------------- |
| Fresh clone / new dependency          | `npm install` → `bun run sources` → dev/build |
| Edited a `.sql` or connector config   | `bun run sources` → restart dev (or build) |
| Edited a markdown page only           | `bun run dev` (live reload, nothing else) |
| Validate production output            | `bun run build` → `bun run preview`       |
| `Cannot find module ...node_sqlite3.node` | `npm rebuild sqlite3 --build-from-source=false` |

## Notes

- Always run these commands with `workdir` set to the Evidence app folder, not the project root.
- Node `>=22.13.0` is required (matches the project's root `package.json`).
- The `.evidence/` and `build/` directories are gitignored and safe to delete; rerun `sources` afterwards.
- `dev` and `preview` cannot run simultaneously on the default port. Stop one before starting the other.
