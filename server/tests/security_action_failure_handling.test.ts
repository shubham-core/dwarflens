import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('P4-22: GitHub Action Failure Handling, Fork PR Graceful Degradation & Permissions', () => {
  const actionYmlPath = path.resolve(__dirname, '../../action/action.yml');
  const actionReadmePath = path.resolve(__dirname, '../../action/README.md');

  it('configures always() or continue-on-error so upload and PR comment run when thresholds fail', () => {
    const content = fs.readFileSync(actionYmlPath, 'utf-8');
    // Upload step must run even if analyze failed
    expect(content).toMatch(/name:\s+Upload Analysis to SaaS[\s\S]*?if:\s+.*always\(\)/);
    // Comment step must run even if analyze failed
    expect(content).toMatch(/name:\s+Post PR Comment[\s\S]*?if:\s+.*always\(\)/);
  });

  it('makes PR comment non-fatal for fork PRs (does not crash when lacking write permissions)', () => {
    const content = fs.readFileSync(actionYmlPath, 'utf-8');
    // Checks that failure to post/patch comment produces a warning instead of failing the job
    expect(content).toMatch(/gh api[\s\S]*?(Warning||| echo||| true)/i);
  });

  it('fails the job at the end when thresholds or budgets fail', () => {
    const content = fs.readFileSync(actionYmlPath, 'utf-8');
    expect(content).toMatch(/Check Final Status|Enforce Status|Enforce Failures/);
    expect(content).toContain('exit 1');
  });

  it('documents permissions: pull-requests: write in action/README.md', () => {
    expect(fs.existsSync(actionReadmePath)).toBe(true);
    const readmeContent = fs.readFileSync(actionReadmePath, 'utf-8');
    expect(readmeContent).toContain('pull-requests: write');
  });
});
