# DwarfLens AI Agent Guide

DwarfLens is a zero-dependency C++23 binary size and DWARF memory layout analyzer (ELF/Wasm/Mach-O/PE) with a native CLI, Action, and Web App, evolving into a CI-driven SaaS.

## Non-Negotiable Rules
1. PRIVACY: Binaries are NEVER uploaded. Only analysis JSON.
2. Zero-dependency C++ core: Never break existing ctest, fuzz targets, or web build.
3. No network code in C++ core/CLI. Uploading happens via GitHub Action (curl) instead.
4. Simple stack: TypeScript on server (Hono, Drizzle, Postgres). No microservices, K8s, queues, or premature abstractions.
5. Security basics: Store API keys only as SHA-256 hashes (+ short visible prefix). Scope EVERY DB query by caller's org. 5MB upload limit, rate limiting.
6. Secrets live in `.env`. Commit only `.env.example`.
7. Product decisions: Choose simplest option, record in `docs/DECISIONS.md`, and proceed. Always update `docs/PROGRESS.md`.

## Repository Map
- `core/`: C++23 zero-dep engine (ELF, Wasm, Mach-O, PE, DWARF, layout, diff, JSON serializer)
- `cli/`: Native CLI executable (`dwarflens analyze|diff`)
- `wasm/`: Emscripten bindings for client-side Wasm
- `web/`: TypeScript + Vite frontend (100% client-side Wasm analyzer + SaaS dashboard)
- `action/`: Composite GitHub Action (`action.yml`)
- `fuzz/`: LLVM libFuzzer and standalone mutation fuzzing suite
- `tests/`: Unit and fixture integration tests (CTest)
- `server/`: SaaS backend API (TypeScript, Hono, Drizzle ORM, Postgres, Vitest)
- `schema/`: JSON Schema definitions for analysis contracts
- `docs/`: ARCHITECTURE.md, PROGRESS.md, DECISIONS.md, DATA_MODEL.md

## Build & Test Commands
- C++ build: `cmake -S . -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo && cmake --build build -j$(nproc)`
- C++ tests: `ctest --test-dir build --output-on-failure`
- Fuzz runner: `./build/fuzz_parsers`
- Web build: `cd web && npm run build`
- Server (Tier A): `cd server && npm test`
