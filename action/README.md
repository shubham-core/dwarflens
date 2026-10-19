# DwarfLens GitHub Action

Automated binary bloat, struct padding, and 64-byte cache-line split tracking for CI/CD pipelines.

- **Privacy-First:** Binaries are never uploaded. Only the analysis JSON is transmitted.
- **Pull Request Comments:** Posts and updates a single clean markdown diff on every pull request.
- **SaaS History:** Uploads metrics to your DwarfLens dashboard for long-term tracking.

---

## Quickstart

Add `.github/workflows/dwarflens.yml` to your repository:

```yaml
name: DwarfLens Binary Analysis

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout PR branch
        uses: actions/checkout@v4

      - name: Build Target Binary
        run: |
          cmake -B build -DCMAKE_BUILD_TYPE=Release
          cmake --build build --target myapp

      # Optional: checkout base branch and build base binary for PR diffs
      - name: Checkout Base Branch
        if: github.event_name == 'pull_request'
        uses: actions/checkout@v4
        with:
          ref: ${{ github.base_ref }}
          path: base-repo

      - name: Build Base Binary
        if: github.event_name == 'pull_request'
        run: |
          cmake -S base-repo -B base-build -DCMAKE_BUILD_TYPE=Release
          cmake --build base-build --target myapp

      - name: Run DwarfLens Action
        uses: shubham-core/dwarflens/action@main
        with:
          target-binary: build/myapp
          base-binary: ${{ github.event_name == 'pull_request' && 'base-build/myapp' || '' }}
          max-growth-bytes: 1048576 # 1 MB
          fail-on-padding-regression: true
          api-url: https://api.dwarflens.dev
          api-key: ${{ secrets.DWARFLENS_API_KEY }}
```

---

## Action Inputs

| Input | Description | Default | Required |
|---|---|---|---|
| `target-binary` | Path to the built binary to inspect | — | **Yes** |
| `base-binary` | Path to base binary to compare against | `''` | No |
| `format` | Output format: `markdown`, `json`, or `table` | `markdown` | No |
| `max-growth-bytes` | Fail step if binary grows by more than $N$ bytes (`-1` disabled) | `-1` | No |
| `fail-on-padding-regression` | Fail step if struct padding increases | `false` | No |
| `api-url` | DwarfLens SaaS API endpoint | `''` | No |
| `api-key` | DwarfLens project API key (`dl_live_...`) | `''` | No |
| `build-name` | Build target identifier (e.g. `release`, `arm64`) | `default` | No |

## Action Outputs

| Output | Description |
|---|---|
| `report` | Full markdown/JSON diff or analysis output |
| `exceeded-threshold` | `true` if growth exceeded `max-growth-bytes` or struct padding regressed |
| `analysis-id` | Stored analysis UUID on DwarfLens SaaS |
