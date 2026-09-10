# Ato integration reference kit

This folder is the executable companion to `../ATO_INTEGRATION_FRAMEWORK.md`.
It is a deliberately small, dependency-free starting point rather than a
finished app integration.

## Contents

- `contracts/v1/`: language-neutral JSON Schemas for events, Centre projections,
  and app capability manifests.
- `openapi/ato-v1.yaml`: the server-to-server API exposed by each app.
- `sql/sqlite/001_ato_integration.sql`: portable D1/SQLite tables for outbox,
  replay protection, commands, cursors, and projections.
- `src/`: zero-dependency JavaScript helpers with TypeScript declarations.
- `examples/`: contract examples grounded in current Organato records.

## Verify

```sh
cd docs/ato-suite/integration
npm test
sqlite3 :memory: < sql/sqlite/001_ato_integration.sql
```

From the repository root (also runs in CI):

```sh
pnpm --filter @ato/integration-kit test
```

The schemas are the source of truth. The JavaScript validator intentionally
checks the envelope's critical invariants only; apps may compile the JSON
Schemas with their existing validator (Organato already uses Zod), generate
types, or write a native adapter in another language.

Do not import code across repository boundaries by filesystem path in
production. Publish a pinned package, vendor a reviewed release, or generate
app-local types from the versioned schemas. Every app must record the exact
contract version it implements.
