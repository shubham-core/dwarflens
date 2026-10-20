import { BillingProvider, CheckoutSessionParams, CustomerPortalParams, SubscriptionInfo, WebhookResult, PlanType } from './types.js';
import { db } from '../db/client.js';
import { orgs } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export class LemonSqueezyBillingProvider implements BillingProvider {
  private apiKey: string;
  private storeId: string;

  constructor(apiKey: string = process.env.LEMON_SQUEEZY_API_KEY || '', storeId: string = process.env.LEMON_SQUEEZY_STORE_ID || '') {
    this.apiKey = apiKey;
    this.storeId = storeId;
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string; sessionId: string }> {
    const { orgId, plan, successUrl, cancelUrl } = params;
    const sessionId = `lemon_cs_${orgId}_${plan}_${Date.now()}`;
    const url = `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id=${sessionId}&provider=lemonsqueezy`;

    return {
      url,
      sessionId,
    };
  }

  async createCustomerPortalSession(params: CustomerPortalParams): Promise<{ url: string }> {
    const { returnUrl, orgId } = params;
    return {
      url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}portal_session=lemon_${orgId}`,
    };
  }

  async getSubscription(orgId: string): Promise<SubscriptionInfo> {
    const [org] = await db
      .select({
        plan: orgs.plan,
        subscriptionStatus: orgs.subscriptionStatus,
        currentPeriodEnd: orgs.currentPeriodEnd,
      })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);

    const plan = (org?.plan || 'free') as PlanType;
    const status = (org?.subscriptionStatus && org.subscriptionStatus !== 'none'
      ? org.subscriptionStatus
      : 'active') as SubscriptionInfo['status'];

    return {
      plan,
      status,
      currentPeriodEnd: org?.currentPeriodEnd,
    };
  }

  async handleWebhook(payload: string, _signature: string): Promise<WebhookResult> {
    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      throw new Error('Invalid Lemon Squeezy webhook payload');
    }

    const eventName = data.meta?.event_name || 'unknown';
    const orgId = data.meta?.custom_data?.org_id;
    let plan: PlanType | undefined;

    if (eventName === 'order_created' || eventName === 'subscription_created') {
      plan = (data.meta?.custom_data?.plan || 'pro') as PlanType;
      if (orgId && plan) {
        await db.update(orgs).set({ plan, subscriptionStatus: 'active', updatedAt: new Date() }).where(eq(orgs.id, orgId));
      }
    } else if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
      if (orgId) {
        await db.update(orgs).set({ plan: 'free', subscriptionStatus: 'canceled', updatedAt: new Date() }).where(eq(orgs.id, orgId));
      }
    }

    return {
      event: eventName,
      orgId,
      plan,
    };
  }
}
