# DwarfLens FAQ & Knowledge Base

---

### Q1: How does DwarfLens ensure my binaries and intellectual property remain private?
**A:** DwarfLens was built with a strict non-negotiable rule: **your binaries are never uploaded to our servers.**
The DwarfLens C++23 engine is completely zero-dependency and contains no HTTP/socket code. It runs 100% locally on your workstation or inside your private CI runner (e.g. GitHub Actions). Only the layout metadata JSON (sections, sizes, struct member offsets) is uploaded.

---

### Q2: What binary formats and debug info does DwarfLens support?
**A:** DwarfLens parses:
- **ELF** (`.elf`, `.so`, `.o`): Linux executables, shared libraries, and embedded firmware.
- **WebAssembly** (`.wasm`): Wasm modules with embedded DWARF custom sections.
- **Mach-O** (`.dylib`, executables): macOS / iOS binaries.
- **PE / COFF** (`.exe`, `.dll`): Windows executables with DWARF debug info.
Supported DWARF standards: **DWARF 4** and **DWARF 5**.

---

### Q3: What is a 64-byte CPU cache-line split and why does DwarfLens flag it?
**A:** Modern CPUs read and write main memory in fixed 64-byte aligned blocks called cache lines. When a single struct member crosses a 64-byte boundary:
1. Accessing that single field requires two separate cache requests.
2. In multi-threaded programs, it increases the likelihood of **false sharing**, where multiple CPU cores invalidate each other's L1/L2 caches unnecessarily.
DwarfLens flags exact byte offsets where fields cross these 64-byte boundaries so you can reorder members for optimal cache efficiency.

---

### Q4: How do automated CI budgets work in GitHub Actions?
**A:** You can configure three budget constraints per project:
1. `max_total_size`: Absolute maximum binary file size in bytes.
2. `max_growth_bytes`: Maximum allowed size increase compared to the base branch.
3. `fail_on_padding_regression`: Fails if total struct padding increases.
When the GitHub Action runs, DwarfLens evaluates these rules against the base analysis. If any budget fails, the action logs the violation reasons in the PR comment and step summary, and terminates with exit code 1 to block merging.

---

### Q5: How do I configure Slack and email alerts?
**A:** In your project settings (or via `PUT /api/v1/projects/:id/alerts`), you can specify:
- A Slack incoming webhook URL.
- An alert email address (defaults to the organization owner if left blank).
When a budget violation occurs on the `main` or `master` branch, DwarfLens immediately delivers a notification detailing the commit, size delta, and reasons.

---

### Q6: Can I use DwarfLens without an account?
**A:** Absolutely:
- **Native CLI:** Run `dwarflens analyze <file>` or `dwarflens diff base.elf head.elf` anywhere offline.
- **WebAssembly Playground:** Visit `#try` in the web app to run the C++ engine compiled to WebAssembly 100% inside your browser. No data ever leaves your browser tab.
