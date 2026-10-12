import { describe, it, expect } from 'vitest';
import { getBillingProvider, setBillingProvider, StripeBillingProvider } from '../src/billing/provider.js';
import { LemonSqueezyBillingProvider } from '../src/billing/lemonSqueezy.js';
import { RazorpayBillingProvider } from '../src/billing/razorpay.js';
import { BillingProvider } from '../src/billing/types.js';

describe('P1-11: Payment Provider Abstraction', () => {
  it('allows swapping between Stripe, Lemon Squeezy, and Razorpay implementations', async () => {
    // 1. Default should be Stripe
    const defaultProvider = getBillingProvider();
    expect(defaultProvider).toBeInstanceOf(StripeBillingProvider);

    // 2. Can switch to Lemon Squeezy provider
    const lemonProvider = new LemonSqueezyBillingProvider();
    setBillingProvider(lemonProvider);
    expect(getBillingProvider()).toBeInstanceOf(LemonSqueezyBillingProvider);

    const lemonCheckout = await lemonProvider.createCheckoutSession({
      orgId: '2267fc88-d603-44d3-9c45-02f09bec971a',
      plan: 'pro',
      successUrl: 'http://localhost:5173/#projects?billing=success',
      cancelUrl: 'http://localhost:5173/#projects?billing=canceled',
    });
    expect(lemonCheckout.url).toBeDefined();
    expect(lemonCheckout.sessionId).toBeDefined();

    // 3. Can switch to Razorpay provider
    const razorpayProvider = new RazorpayBillingProvider();
    setBillingProvider(razorpayProvider);
    expect(getBillingProvider()).toBeInstanceOf(RazorpayBillingProvider);

    const razorpayCheckout = await razorpayProvider.createCheckoutSession({
      orgId: '2267fc88-d603-44d3-9c45-02f09bec971a',
      plan: 'pro',
      successUrl: 'http://localhost:5173/#projects?billing=success',
      cancelUrl: 'http://localhost:5173/#projects?billing=canceled',
    });
    expect(razorpayCheckout.url).toBeDefined();
    expect(razorpayCheckout.sessionId).toBeDefined();

    // Restore default Stripe provider
    setBillingProvider(defaultProvider);
  });
});
