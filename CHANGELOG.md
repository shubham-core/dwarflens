# Changelog

All notable changes to the DwarfLens project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-10-23

### Added
- **Zero-Dependency C++23 Core Engine:** Native ELF64, WebAssembly, Mach-O 64-bit, and Windows PE/COFF container parsers.
- **DWARF v4 / v5 DIE Walker:** Custom parser for `.debug_info`, `.debug_abbrev`, and `.debug_str` extracting struct layouts, field offsets, alignments, and padding holes.
- **Cache-Line Analysis:** Detection of 64-byte CPU cache-line crossings with min and max bounds based on alignment placement.
- **Size-Optimal Struct Repacker:** Descending alignment field reordering engine with automated C++ and Rust code snippet generation and ABI safety warnings.
- **Binary Diff Engine:** High-performance delta calculator comparing section footprints and struct padding regressions between base and target builds.
- **Native CLI (`dwarflens`):** Formatted terminal tables, machine-readable JSON, and GitHub-ready Markdown outputs.
- **Interactive WebAssembly Client:** Zero-install dark-mode web application running 100% locally in the browser with proportional treemaps and struct X-Ray inspector.
- **Composite GitHub Action:** Automated PR regression commenting and CI budget enforcement (`--max-growth-bytes`, `--fail-on-padding-regression`).
- **DwarfLens Cloud (SaaS):** Multi-tenant backend API (Hono, Drizzle ORM, PostgreSQL) with GitHub OAuth, team organization management, and automated webhook alerts (Slack & Resend).
- **Fuzzing & Memory Safety:** LLVM libFuzzer target with AddressSanitizer (ASan) and UndefinedBehaviorSanitizer (UBSan) testing.
