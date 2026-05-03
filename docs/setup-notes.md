# Setup Notes

## Why this repo is split this way

The project has two different execution surfaces:

- the orchestration code you will write
- the Evidence app that gets generated, tested, or repaired

That is why `dashboard-workspace/dashboard-app/` exists even before the app is initialized.

## What you should do now

### Mastra

Install and initialize Mastra in the repository root using the official docs.

Target outcome:

- the Mastra app lives at the repo root
- your source code stays under `src/`
- the runtime workspace for generated dashboards stays under `dashboard-workspace/`

### Evidence

Install Evidence manually inside `dashboard-workspace/dashboard-app/` and use it as a sandbox to learn the build flow.

Target commands:

```bash
cd dashboard-workspace/dashboard-app
npm create evidence@latest .
npm install
npm run sources
npm run dev
```

## What not to do yet

- do not mix generated dashboard files into `src/`
- do not build the full agent before you have one working Evidence example
- do not assume the final workflow until the local build loop is proven