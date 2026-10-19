# Contributing to DwarfLens

Thank you for your interest in contributing to DwarfLens! Whether you are fixing a bug, adding support for a new binary format, optimizing data structure layouts, or enhancing the SaaS platform, we welcome your contributions.

---

## 🧭 Core Architectural Principles

Before contributing code, please keep these non-negotiable architectural principles in mind:

1. **Zero-Knowledge Privacy:** Binaries are **NEVER** uploaded to remote servers or cloud backends. Only analysis JSON metadata is uploaded by the GitHub Action.
2. **Zero-Dependency C++ Core:** The `core/` engine and `cli/` must stay 100% zero-dependency. Do not introduce Boost, libelf, libdwarf, or external C/C++ packages.
3. **No Network Code in C++:** Network and HTTP logic live strictly in the GitHub Action (`action/`) or the TypeScript backend (`server/`). The C++ CLI remains entirely offline.
4. **Simple, Reliable Stack:** The SaaS server uses TypeScript, Hono, Drizzle ORM, and PostgreSQL. Keep abstractions minimal and boring.
5. **Multi-Tenant Isolation:** Every server query must be strictly scoped to the caller's organization. API keys are stored only as SHA-256 hashes.

---

## 📁 Repository Structure

```text
dwarflens/
├── core/         # Zero-dependency C++23 parsing engine (ELF, DWARF, Mach-O, PE, Wasm)
├── cli/          # Native CLI tool (table, JSON, and markdown output)
├── wasm/         # Emscripten WebAssembly bindings for browser execution
├── web/          # Vite + TypeScript SPA (landing page, Wasm analyzer, SaaS dashboard)
├── server/       # Hono + Drizzle ORM + PostgreSQL SaaS backend API
├── action/       # Composite GitHub Action for CI binary size diff comments
├── schema/       # Formal JSON Schema contracts (analysis.v1.schema.json)
├── tests/        # Native unit tests and schema compliance tests
├── fuzz/         # libFuzzer targets for binary parser resilience
└── docs/         # Architecture, quickstart, API, and deployment documentation
```

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **C++ Compiler:** GCC 13+, Clang 17+, or Apple Clang supporting C++23.
- **Build Tools:** CMake 3.25+ and Ninja.
- **Node.js:** Node.js 20+ and npm.
- **Docker:** Docker and Docker Compose (for local PostgreSQL).

---

### 2. Building the C++ Engine & CLI

```bash
# Configure build directory
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo

# Compile native binary and tests
cmake --build build -j$(nproc)

# Run test suite
ctest --test-dir build --output-on-failure
```

Run CLI smoke tests:
```bash
./build/dwarflens analyze ./build/dwarflens --format=table
./build/dwarflens analyze ./build/dwarflens --format=json
```

---

### 3. Running Web Dashboard & Wasm Analyzer

```bash
# Install web dependencies
npm install --prefix web

# Start local dev server (http://localhost:5173)
npm run dev --prefix web

# Verify production build
npm run build --prefix web
```

---

### 4. Running the Server Backend

```bash
# Start local PostgreSQL container (runs on port 5432)
docker compose up -d

# Install server dependencies
npm install --prefix server

# Run database migrations
npm run db:migrate --prefix server

# Run Vitest test suite
npm test --prefix server

# Start server in development watch mode (http://localhost:3000)
npm run dev --prefix server
```

---

### 5. Running Fuzzing Targets (Linux Clang)

```bash
cmake -S . -B build-fuzz -G Ninja \
  -DCMAKE_CXX_COMPILER=clang++ \
  -DENABLE_FUZZING=ON

cmake --build build-fuzz --target fuzz_elf_parser -j
./build-fuzz/fuzz/fuzz_elf_parser -max_total_time=60
```

---

## 🧪 Testing Checklist Before Submitting a PR

Before submitting a Pull Request, verify that all test suites across the repository pass cleanly:

```bash
# 1. Native CTest suite (including JSON schema validation)
ctest --test-dir build --output-on-failure

# 2. Server Vitest suite (database isolation, ingest, budgets, alerts, teams, billing)
npm test --prefix server

# 3. Web frontend TypeScript and Vite bundle verification
npm run build --prefix web
```

---

## 📝 Commit Conventions

We follow Conventional Commits:
- `feat(core): ...` or `feat(server): ...` for new capabilities.
- `fix(cli): ...` or `fix(action): ...` for bug fixes.
- `docs(...)`: for documentation improvements.
- `chore(...)`: for dependency updates or CI maintenance.

Thank you for helping build DwarfLens!
