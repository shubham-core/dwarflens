# 5-Minute Quickstart Guide

Get DwarfLens running in your local environment and CI pipeline in under 5 minutes.

---

## Step 1: Install or Build the CLI

DwarfLens is a zero-dependency C++23 native binary analyzer.

### Option A: Build from Source (Linux / macOS / Windows)
```bash
git clone https://github.com/shubham-core/dwarflens.git
cd dwarflens
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
```
The compiled executable will be located at `./build/cli/dwarflens` (or `dwarflens.exe` on Windows).

### Option B: Quick Symlink
```bash
sudo ln -sf $(pwd)/build/cli/dwarflens /usr/local/bin/dwarflens
```

---

## Step 2: Run a Local Binary Analysis

Compile your project with DWARF debug info (`-g` in GCC/Clang/Rustc) and run DwarfLens:

```bash
# Human-readable CLI table
dwarflens analyze ./firmware.elf

# Deep struct padding and cache-line split inspection
dwarflens structs ./firmware.elf

# Generate JSON analysis report
dwarflens analyze ./firmware.elf --format=json > analysis.json
```

---

## Step 3: Create a Project and API Key

1. Navigate to the DwarfLens Dashboard (e.g. `https://dwarflens.dev` or local `http://localhost:5173/#login`).
2. Sign in with GitHub.
3. Click **"New Project"**, enter your repository name (e.g. `my-org/my-binary`), and click **"Create Project"**.
4. Copy the generated API key (`dl_live_...`). Save this secret — it is only displayed once!

---

## Step 4: Add DwarfLens to GitHub Actions

Add the following workflow file to `.github/workflows/dwarflens.yml`:

```yaml
name: DwarfLens Binary Size & Layout CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Build Binary
        run: |
          # Build your binary with debug symbols (-g)
          cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS="-g"
          cmake --build build --target my_firmware

      - name: Run DwarfLens Analyzer
        uses: shubham-core/dwarflens/action@main
        with:
          target: build/my_firmware.elf
          api-url: https://api.dwarflens.dev
          api-key: ${{ secrets.DWARFLENS_API_KEY }}
          build-name: release-x86_64
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

In your GitHub repository settings, add the secret `DWARFLENS_API_KEY` under **Settings > Secrets and variables > Actions**.

---

## Step 5: Verify CI Results

On every pull request, DwarfLens will:
1. Run the native C++ engine inside your GitHub Actions runner (zero binaries are uploaded).
2. Upload the lightweight layout JSON summary.
3. Post or update a single formatted PR comment showing section growth, symbol deltas, and padding regressions.
4. Fail the build if any configured project budgets are exceeded.
