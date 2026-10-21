import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('P5-25: Security Documentation & Regression Verification', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const securityDocPath = path.resolve(rootDir, 'docs/SECURITY.md');
  const testsDir = path.resolve(__dirname, '../tests');

  it('provides comprehensive docs/SECURITY.md covering architecture, reporting and threat model', () => {
    expect(fs.existsSync(securityDocPath)).toBe(true);
    const content = fs.readFileSync(securityDocPath, 'utf-8');

    // 1. Supported versions
    expect(content).toMatch(/Supported Versions/i);
    expect(content).toMatch(/v0\.1/i);

    // 2. Reporting
    expect(content).toMatch(/Reporting a Vulnerability/i);
    expect(content).toMatch(/security@|response/i);

    // 3. Security Architecture Overview
    expect(content).toMatch(/Multi-Tenant Isolation/i);
    expect(content).toMatch(/Session Security & Token Hashing/i);
    expect(content).toMatch(/API Key Scoping/i);
    expect(content).toMatch(/Webhook & Cron Cryptographic Verification/i);
    expect(content).toMatch(/CORS & Network Boundary Policy/i);
    expect(content).toMatch(/Rate Limiting & Abuse Prevention/i);
    expect(content).toMatch(/Input Validation & XSS Sanitization/i);
    expect(content).toMatch(/GitHub Action CI Hardening/i);

    // 4. Checklist verification
    expect(content).toMatch(/Security Controls Checklist/i);
  });

  it('maintains automated security test files covering every security category', () => {
    const testFiles = fs.readdirSync(testsDir);
    const requiredSuites = [
      'security_cors.test.ts',
      'security_webhook.test.ts',
      'security_retention.test.ts',
      'security_devlogin.test.ts',
      'security_oauth.test.ts',
      'security_db.test.ts',
      'security_xss.test.ts',
      'security_stripe_checkout.test.ts',
      'security_billing_ui.test.ts',
      'security_plan_limits.test.ts',
      'security_billing_abstraction.test.ts',
      'security_api_key_scopes.test.ts',
      'security_alert_hardening.test.ts',
      'security_invitations.test.ts',
      'security_input_validation.test.ts',
      'security_rate_limiting.test.ts',
      'security_session_hardening.test.ts',
      'security_cross_origin_login.test.ts',
      'security_action_injection.test.ts',
      'security_action_binary_download.test.ts',
      'security_action_failure_handling.test.ts',
      'security_release_workflow.test.ts',
      'security_cleanup_hygiene.test.ts',
    ];

    for (const suite of requiredSuites) {
      expect(testFiles).toContain(suite);
    }
  });
});
