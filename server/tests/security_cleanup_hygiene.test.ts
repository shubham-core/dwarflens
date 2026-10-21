import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { envSchema } from '../src/env.js';

describe('P5-24: Cleanup & Production Hygiene', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const gitignorePath = path.resolve(rootDir, '.gitignore');
  const renderYamlPath = path.resolve(rootDir, 'render.yaml');
  const needsUserPath = path.resolve(rootDir, 'docs/NEEDS_USER.md');
  const deploymentPath = path.resolve(rootDir, 'docs/DEPLOYMENT.md');
  const sharesRoutePath = path.resolve(__dirname, '../src/routes/shares.ts');

  it('normalizes APP_URL by stripping any trailing slash', () => {
    const parsed = envSchema.parse({
      ...process.env,
      APP_URL: 'https://shubham-core.github.io/dwarflens/',
      NODE_ENV: 'test',
    });
    expect(parsed.APP_URL).toBe('https://shubham-core.github.io/dwarflens');
    expect(parsed.APP_URL.endsWith('/')).toBe(false);
  });

  it('guarantees share link generation does not create double slashes (//#shared/)', () => {
    const content = fs.readFileSync(sharesRoutePath, 'utf-8');
    // Ensure APP_URL is not directly concatenated with '/#shared/' without slash-stripping or normalization
    expect(content).not.toMatch(/\$\{env\.APP_URL\}\/#shared/);
  });

  it('ignores web/dist in .gitignore and does not track web/dist in git', () => {
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    expect(gitignore).toMatch(/web\/dist/);

    const tracked = execSync('git ls-files web/dist', { cwd: rootDir, encoding: 'utf-8' }).trim();
    expect(tracked).toBe('');
  });

  it('defines explicit NODE_ENV=production in render.yaml', () => {
    expect(fs.existsSync(renderYamlPath)).toBe(true);
    const renderYaml = fs.readFileSync(renderYamlPath, 'utf-8');
    expect(renderYaml).toMatch(/key:\s*NODE_ENV[\s\S]*?value:\s*production/);
  });

  it('documents branch protection rule requiring CI status checks before merge in NEEDS_USER.md and DEPLOYMENT.md', () => {
    const needsUser = fs.readFileSync(needsUserPath, 'utf-8');
    expect(needsUser).toMatch(/Branch Protection/i);
    expect(needsUser).toMatch(/Require status checks to pass/i);

    const deployment = fs.readFileSync(deploymentPath, 'utf-8');
    expect(deployment).toMatch(/Branch Protection/i);
  });
});
