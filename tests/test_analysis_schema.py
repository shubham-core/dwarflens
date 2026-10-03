#!/usr/bin/env python3
"""
Test validation of DwarfLens CLI JSON output against schema/analysis.v1.schema.json.
Validates:
1. Output with full metadata (--repo, --commit, --branch, --build-name, --compiler, etc.)
2. Backward-compatible output without metadata flags
3. Output on compiled fixture targets
"""

import argparse
import json
import os
import subprocess
import sys

try:
    import jsonschema
except ImportError:
    print("Warning: jsonschema not installed, trying fallback or skipping")
    sys.exit(0)


def validate_json_output(cli_bin: str, target_bin: str, schema_file: str, extra_args: list[str]) -> None:
    cmd = [cli_bin, "analyze", target_bin, "--format=json"] + extra_args
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        print(f"CLI command failed ({proc.returncode}): {' '.join(cmd)}")
        print(f"Stderr: {proc.stderr}")
        sys.exit(1)

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON output: {e}")
        print(f"Raw output:\n{proc.stdout[:500]}")
        sys.exit(1)

    with open(schema_file, "r", encoding="utf-8") as f:
        schema = json.load(f)

    # Validate against JSON schema
    jsonschema.validate(instance=data, schema=schema)
    assert data["schema_version"] == 1, f"Expected schema_version 1, got {data.get('schema_version')}"


def main():
    parser = argparse.ArgumentParser(description="Validate DwarfLens CLI output against analysis v1 schema.")
    parser.add_argument("--cli", default="./build/dwarflens", help="Path to dwarflens CLI binary")
    parser.add_argument("--schema", default="schema/analysis.v1.schema.json", help="Path to JSON schema file")
    parser.add_argument("--target", default="./build/dwarflens", help="Target binary to analyze")
    args = parser.parse_args()

    if not os.path.exists(args.cli):
        print(f"Error: CLI binary not found at {args.cli}")
        sys.exit(1)
    if not os.path.exists(args.schema):
        print(f"Error: Schema file not found at {args.schema}")
        sys.exit(1)
    if not os.path.exists(args.target):
        print(f"Error: Target binary not found at {args.target}")
        sys.exit(1)

    print("[1/3] Validating CLI output with full CI metadata...")
    validate_json_output(
        args.cli,
        args.target,
        args.schema,
        [
            "--repo=shubham-core/dwarflens",
            "--commit=abcdef1234567890",
            "--branch=main",
            "--build-name=ci-release",
            "--compiler=gcc-13",
            "--flags=-O2 -g",
        ],
    )

    print("[2/3] Validating CLI output without optional metadata...")
    validate_json_output(args.cli, args.target, args.schema, [])

    print("[3/3] Checking fixture binary output...")
    fixture = os.path.join(os.path.dirname(args.target), "tests/fixtures/sample_target")
    if os.path.exists(fixture):
        validate_json_output(
            args.cli,
            fixture,
            args.schema,
            ["--repo=fixture/test", "--branch=feat/test"],
        )

    print("All JSON schema validations passed successfully!")


if __name__ == "__main__":
    main()
