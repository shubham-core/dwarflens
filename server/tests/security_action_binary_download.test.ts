import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('P4-21: GitHub Action Release Binary Download & Fallback to ACTION_PATH/..', () => {
  const actionPath = path.resolve(__dirname, '../../action/action.yml');
  const content = fs.readFileSync(actionPath, 'utf-8');

  it('passes ACTION_PATH and VERSION through env in Setup DwarfLens step', () => {
    expect(content).toContain('ACTION_PATH: ${{ github.action_path }}');
    expect(content).toContain('VERSION: ${{ inputs.dwarflens-version }}');
  });

  it('implements SHA256 checksum verification for downloaded release binaries', () => {
    expect(content).toMatch(/sha256sum\s+-c|shasum\s+-a\s+256\s+-c/);
    expect(content).toContain('.sha256');
  });

  it('uses ACTION_PATH/.. to locate DwarfLens source when falling back to build', () => {
    expect(content).toContain('${ACTION_PATH}/..');
  });

  it('defaults dwarflens-version input to a valid release version', () => {
    expect(content).toMatch(/dwarflens-version:\s*\n\s+description:[^\n]+\n\s+required:\s*false\n\s+default:\s*['"]?v0\.1\.0['"]?/);
  });
});
