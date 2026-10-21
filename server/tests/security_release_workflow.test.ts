import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('P4-23: Release Workflow Runner Hardening & macOS Migration', () => {
  const releaseYmlPath = path.resolve(__dirname, '../../.github/workflows/release.yml');

  it('does not use deprecated macos-13 runner which fails on GitHub Actions', () => {
    const content = fs.readFileSync(releaseYmlPath, 'utf-8');
    expect(content).not.toContain('macos-13');
  });

  it('uses supported macos runner (macos-14 or macos-latest) for macOS builds', () => {
    const content = fs.readFileSync(releaseYmlPath, 'utf-8');
    expect(content).toMatch(/os:\s+(macos-14|macos-latest)/);
  });

  it('contains valid release matrix with linux, macos, and windows targets', () => {
    const content = fs.readFileSync(releaseYmlPath, 'utf-8');
    expect(content).toContain('ubuntu-latest');
    expect(content).toContain('windows-latest');
    expect(content).toContain('dwarflens-linux-x86_64');
    expect(content).toContain('dwarflens-macos-arm64');
    expect(content).toContain('dwarflens-windows-x86_64');
  });
});
