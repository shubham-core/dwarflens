import { BillingProvider, CheckoutSessionParams, CustomerPortalParams, SubscriptionInfo, WebhookResult, PlanType } from './types.js';
import { db } from '../db/client.js';
import { orgs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { env } from '../env.js';

export class StripeBillingProvider implements BillingProvider {
  private secretKey: string;

  constructor(secretKey: string = process.env.STRIPE_SECRET_KEY || '') {
    this.secretKey = secretKey;
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string; sessionId: string }> {
    const { orgId, plan, successUrl, cancelUrl } = params;

    if (this.secretKey) {
      // In production with Stripe API key
      const body = new URLSearchParams({
        'client_reference_id': orgId,
        'metadata[org_id]': orgId,
        'metadata[plan]': plan,
        'mode': 'subscription',
        'success_url': successUrl,
        'cancel_url': cancelUrl,
      });

      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
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

    if (this.secretKey) {
      const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
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

    return {
      url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}portal_session=mock_${orgId}`,
    };
  }

  async getSubscription(orgId: string): Promise<SubscriptionInfo> {
    const [org] = await db
      .select({ plan: orgs.plan })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);

    const plan = (org?.plan || 'free') as PlanType;
    return {
      plan,
      status: 'active',
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

    if (event === 'checkout.session.completed') {
      const session = data.data?.object || data.session || {};
      const customerId = session.customer ? String(session.customer) : undefined;
      const clientRefOrgId = session.client_reference_id || session.metadata?.org_id;
      plan = (session.metadata?.plan || 'pro') as PlanType;

      const isUuid = (val?: string): val is string => !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

      let targetOrg: { id: string } | undefined;
      if (customerId) {
        const [foundByCustomer] = await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.stripeCustomerId, customerId))
          .limit(1);
        targetOrg = foundByCustomer;
      }
      if (!targetOrg && isUuid(clientRefOrgId)) {
        const [foundById] = await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.id, clientRefOrgId))
          .limit(1);
        targetOrg = foundById;
      }

      if (targetOrg && plan) {
        orgId = targetOrg.id;
        await db
          .update(orgs)
          .set({
            plan,
            ...(customerId ? { stripeCustomerId: customerId } : {}),
            updatedAt: new Date(),
          })
          .where(eq(orgs.id, targetOrg.id));
      }
    } else if (event === 'customer.subscription.deleted') {
      const isUuid = (val?: string): val is string => !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      const subscription = data.data?.object || data.subscription || {};
      const customerId = subscription.customer ? String(subscription.customer) : undefined;

      let targetOrg: { id: string } | undefined;
      if (customerId) {
        const [foundByCustomer] = await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.stripeCustomerId, customerId))
          .limit(1);
        targetOrg = foundByCustomer;
      }
      if (!targetOrg && isUuid(subscription.metadata?.org_id)) {
        const [foundById] = await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.id, subscription.metadata.org_id))
          .limit(1);
        targetOrg = foundById;
      }

      if (targetOrg) {
        orgId = targetOrg.id;
        await db
          .update(orgs)
          .set({ plan: 'free', updatedAt: new Date() })
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

let activeProvider: BillingProvider = new StripeBillingProvider();

export function getBillingProvider(): BillingProvider {
  return activeProvider;
}

export function setBillingProvider(provider: BillingProvider): void {
  activeProvider = provider;
}
