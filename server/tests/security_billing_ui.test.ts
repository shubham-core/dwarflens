import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('P1-9: Frontend Billing UI & Upgrade Controls', () => {
  const root = path.resolve(__dirname, '../../');
  const dashboardPath = path.join(root, 'web/src/dashboard.ts');
  const landingPath = path.join(root, 'web/src/landing.ts');
  const indexPath = path.join(root, 'web/index.html');
  const apiPath = path.join(root, 'web/src/api.ts');

  it('declares view-billing container in web/index.html', () => {
    const html = fs.readFileSync(indexPath, 'utf-8');
    expect(html).toContain('id="view-billing"');
  });

  it('exposes billing methods in web/src/api.ts (getBilling, createCheckoutSession, createCustomerPortalSession)', () => {
    const apiCode = fs.readFileSync(apiPath, 'utf-8');
    expect(apiCode).toContain('getBilling(');
    expect(apiCode).toContain('createCheckoutSession(');
    expect(apiCode).toContain('createCustomerPortalSession(');
  });

  it('implements #billing route and renderBillingView in web/src/dashboard.ts', () => {
    const dashCode = fs.readFileSync(dashboardPath, 'utf-8');
    expect(dashCode).toContain("'view-billing'");
    expect(dashCode).toContain("hash.startsWith('#billing')");
    expect(dashCode).toContain('renderBillingView(');
    expect(dashCode).toContain('Manage Subscription');
  });

  it('provides upgrade buttons in pricing section of web/src/landing.ts', () => {
    const landingCode = fs.readFileSync(landingPath, 'utf-8');
    expect(landingCode).toMatch(/Upgrade to Pro|Start Pro/);
    expect(landingCode).toContain('data-plan="pro"');
    expect(landingCode).toContain('data-plan="team"');
  });
});
