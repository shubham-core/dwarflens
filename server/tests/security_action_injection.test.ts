import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('P4-20: GitHub Action Script Injection Safety', () => {
  it('ensures no ${{ }} expression is interpolated inside any run: script block in action/action.yml', () => {
    const actionPath = path.resolve(__dirname, '../../action/action.yml');
    expect(fs.existsSync(actionPath)).toBe(true);

    const content = fs.readFileSync(actionPath, 'utf-8');
    const lines = content.split('\n');

    let insideRunBlock = false;
    let runBlockIndent = 0;
    const violations: Array<{ lineNumber: number; line: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check if entering a run: block
      const runMatch = line.match(/^(\s*)run:\s*(\|.*)?$/);
      if (runMatch) {
        insideRunBlock = true;
        runBlockIndent = runMatch[1].length;
        continue;
      }

      if (insideRunBlock) {
        // Check if we exited the run: block (line is non-empty and indented <= runBlockIndent)
        const currentIndentMatch = line.match(/^(\s*)\S/);
        if (currentIndentMatch) {
          const currentIndent = currentIndentMatch[1].length;
          if (currentIndent <= runBlockIndent) {
            insideRunBlock = false;
          }
        }
      }

      if (insideRunBlock) {
        if (line.includes('${{')) {
          violations.push({ lineNumber: i + 1, line: line.trim() });
        }
      }
    }

    if (violations.length > 0) {
      const details = violations.map((v) => `Line ${v.lineNumber}: ${v.line}`).join('\n');
      expect.fail(`Found direct \${{ }} interpolations inside action run: scripts:\n${details}`);
    }
  });
});
