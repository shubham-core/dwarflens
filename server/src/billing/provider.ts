import { BillingProvider, CheckoutSessionParams, CustomerPortalParams, SubscriptionInfo, WebhookResult, PlanType } from './types.js';
import { db } from '../db/client.js';
import { orgs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { env } from '../env.js';

export class StripeBillingProvider implements BillingProvider {
  private secretKey?: string;

  constructor(secretKey?: string) {
    this.secretKey = secretKey;
  }

  private getEffectiveSecretKey(): string {
    return this.secretKey || env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || '';
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string; sessionId: string }> {
    const { orgId, plan, successUrl, cancelUrl } = params;

    const [org] = await db
      .select({ stripeCustomerId: orgs.stripeCustomerId })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);

    const effectiveKey = this.getEffectiveSecretKey();

    if (effectiveKey) {
      // In production with Stripe API key
      const priceId = plan === 'team'
        ? (env.STRIPE_PRICE_TEAM || process.env.STRIPE_PRICE_TEAM || '')
        : (env.STRIPE_PRICE_PRO || process.env.STRIPE_PRICE_PRO || '');

      if (!priceId) {
        throw new Error(`Missing Stripe price ID for plan "${plan}". Configure STRIPE_PRICE_${plan.toUpperCase()}.`);
      }

      let stripeCustomerId = org?.stripeCustomerId;
      if (!stripeCustomerId) {
        // Create Stripe customer and store on org
        const custRes = await fetch('https://api.stripe.com/v1/customers', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${effectiveKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            'metadata[org_id]': orgId,
            description: `DwarfLens Org ${orgId}`,
          }).toString(),
        });

        if (!custRes.ok) {
          const custErr = await custRes.text();
          throw new Error(`Stripe customer creation error: ${custErr}`);
        }

        const custData = await custRes.json();
        stripeCustomerId = custData.id;
        await db
          .update(orgs)
          .set({ stripeCustomerId, updatedAt: new Date() })
          .where(eq(orgs.id, orgId));
      }

      const bodyParams: Record<string, string> = {
        client_reference_id: orgId,
        'metadata[org_id]': orgId,
        'metadata[plan]': plan,
        'subscription_data[metadata][org_id]': orgId,
        'subscription_data[metadata][plan]': plan,
        mode: 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        customer: stripeCustomerId!,
        success_url: successUrl,
        cancel_url: cancelUrl,
      };

      const body = new URLSearchParams(bodyParams);

      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${effectiveKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Stripe error: ${err}`);
      }

      const session = await res.json();
      return { url: session.url, sessionId: session.id };
    }

    // Default mock / dev implementation
    const sessionId = `mock_cs_${orgId}_${plan}_${Date.now()}`;
    const redirectUrl = `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id=${sessionId}&plan=${plan}`;
    return {
      url: redirectUrl,
      sessionId,
    };
  }

  async createCustomerPortalSession(params: CustomerPortalParams): Promise<{ url: string }> {
    const { orgId, returnUrl } = params;

    const [org] = await db
      .select({ stripeCustomerId: orgs.stripeCustomerId })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);

    const effectiveKey = this.getEffectiveSecretKey();

    if (effectiveKey) {
      if (!org?.stripeCustomerId) {
        throw new Error('Cannot open customer portal: No Stripe customer ID found for this organization. Upgrade first.');
      }

      const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${effectiveKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          customer: org.stripeCustomerId,
          return_url: returnUrl,
        }).toString(),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Stripe Portal error: ${err}`);
      }

      const session = await res.json();
      return { url: session.url };
    }

    const customer = org?.stripeCustomerId || orgId;
    return {
      url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}portal_session=mock_${customer}`,
    };
  }

  async getSubscription(orgId: string): Promise<SubscriptionInfo> {
    const [org] = await db
      .select({
        plan: orgs.plan,
        subscriptionStatus: orgs.subscriptionStatus,
        currentPeriodEnd: orgs.currentPeriodEnd,
        stripeCustomerId: orgs.stripeCustomerId,
        stripeSubscriptionId: orgs.stripeSubscriptionId,
      })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);

    if (!org) {
      return {
        plan: 'free',
        status: 'none',
      };
    }

    const plan = (org.plan || 'free') as PlanType;
    const status = (org.subscriptionStatus && org.subscriptionStatus !== 'none'
      ? org.subscriptionStatus
      : 'active') as SubscriptionInfo['status'];

    return {
      plan,
      status,
      currentPeriodEnd: org.currentPeriodEnd,
      stripeCustomerId: org.stripeCustomerId,
      stripeSubscriptionId: org.stripeSubscriptionId,
    };
  }

  async handleWebhook(payload: string, signature: string): Promise<WebhookResult> {
    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      throw new Error('Invalid webhook JSON');
    }

    const event = data.type || data.event || 'unknown';
    let orgId: string | undefined;
    let plan: PlanType | undefined;

    const isUuid = (val?: string): val is string => !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    async function findOrg(customerId?: string, metaOrgId?: string): Promise<{ id: string } | undefined> {
      if (customerId) {
        const [foundByCustomer] = await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.stripeCustomerId, customerId))
          .limit(1);
        if (foundByCustomer) return foundByCustomer;
      }
      if (isUuid(metaOrgId)) {
        const [foundById] = await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.id, metaOrgId))
          .limit(1);
        if (foundById) return foundById;
      }
      return undefined;
    }

    if (event === 'checkout.session.completed') {
      const session = data.data?.object || data.session || {};
      const customerId = session.customer ? String(session.customer) : undefined;
      const subscriptionId = session.subscription ? String(session.subscription) : undefined;
      const clientRefOrgId = session.client_reference_id || session.metadata?.org_id;
      plan = (session.metadata?.plan || 'pro') as PlanType;

      const targetOrg = await findOrg(customerId, clientRefOrgId);

      if (targetOrg && plan) {
        orgId = targetOrg.id;
        await db
          .update(orgs)
          .set({
            plan,
            subscriptionStatus: 'active',
            ...(customerId ? { stripeCustomerId: customerId } : {}),
            ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
            updatedAt: new Date(),
          })
          .where(eq(orgs.id, targetOrg.id));
      }
    } else if (event === 'customer.subscription.updated') {
      const subscription = data.data?.object || data.subscription || {};
      const customerId = subscription.customer ? String(subscription.customer) : undefined;
      const subscriptionId = subscription.id ? String(subscription.id) : undefined;
      const status = subscription.status ? String(subscription.status) : 'active';
      const currentPeriodEndUnix = subscription.current_period_end ? Number(subscription.current_period_end) : undefined;
      const currentPeriodEndDate = currentPeriodEndUnix ? new Date(currentPeriodEndUnix * 1000) : undefined;
      plan = subscription.metadata?.plan as PlanType | undefined;

      const targetOrg = await findOrg(customerId, subscription.metadata?.org_id);

      if (targetOrg) {
        orgId = targetOrg.id;
        const updateData: Record<string, any> = {
          subscriptionStatus: status,
          updatedAt: new Date(),
        };
        if (subscriptionId) updateData.stripeSubscriptionId = subscriptionId;
        if (currentPeriodEndDate) updateData.currentPeriodEnd = currentPeriodEndDate;
        if (plan) updateData.plan = plan;

        await db.update(orgs).set(updateData).where(eq(orgs.id, targetOrg.id));
      }
    } else if (event === 'customer.subscription.deleted') {
      const subscription = data.data?.object || data.subscription || {};
      const customerId = subscription.customer ? String(subscription.customer) : undefined;

      const targetOrg = await findOrg(customerId, subscription.metadata?.org_id);

      if (targetOrg) {
        orgId = targetOrg.id;
        await db
          .update(orgs)
          .set({
            plan: 'free',
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
            updatedAt: new Date(),
          })
          .where(eq(orgs.id, targetOrg.id));
      }
    } else if (event === 'invoice.payment_failed') {
      const invoice = data.data?.object || data.invoice || {};
      const customerId = invoice.customer ? String(invoice.customer) : undefined;

      const targetOrg = await findOrg(customerId, invoice.metadata?.org_id);

      if (targetOrg) {
        orgId = targetOrg.id;
        await db
          .update(orgs)
          .set({
            subscriptionStatus: 'past_due',
            updatedAt: new Date(),
          })
          .where(eq(orgs.id, targetOrg.id));
      }
    }

    return {
      event,
      orgId,
      plan,
    };
  }
}

import { LemonSqueezyBillingProvider } from './lemonSqueezy.js';
import { RazorpayBillingProvider } from './razorpay.js';

function createDefaultBillingProvider(): BillingProvider {
  const provider = (process.env.BILLING_PROVIDER || 'stripe').toLowerCase();
  if (provider === 'lemonsqueezy' || provider === 'lemon_squeezy') {
    return new LemonSqueezyBillingProvider();
  }
  if (provider === 'razorpay') {
    return new RazorpayBillingProvider();
  }
  return new StripeBillingProvider();
}

let activeProvider: BillingProvider = createDefaultBillingProvider();

export function getBillingProvider(): BillingProvider {
  return activeProvider;
}

export function setBillingProvider(provider: BillingProvider): void {
  activeProvider = provider;
}
