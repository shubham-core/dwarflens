import { BillingProvider, CheckoutSessionParams, CustomerPortalParams, SubscriptionInfo, WebhookResult, PlanType } from './types.js';
import { db } from '../db/client.js';
import { orgs } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export class RazorpayBillingProvider implements BillingProvider {
  private keyId: string;
  private keySecret: string;

  constructor(keyId: string = process.env.RAZORPAY_KEY_ID || '', keySecret: string = process.env.RAZORPAY_KEY_SECRET || '') {
    this.keyId = keyId;
    this.keySecret = keySecret;
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string; sessionId: string }> {
    const { orgId, plan, successUrl, cancelUrl } = params;
    const sessionId = `order_rzp_${orgId}_${plan}_${Date.now()}`;
    const url = `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id=${sessionId}&provider=razorpay`;

    return {
      url,
      sessionId,
    };
  }

  async createCustomerPortalSession(params: CustomerPortalParams): Promise<{ url: string }> {
    const { returnUrl, orgId } = params;
    return {
      url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}portal_session=rzp_${orgId}`,
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
      throw new Error('Invalid Razorpay webhook payload');
    }

    const event = data.event || 'unknown';
    const notes = data.payload?.subscription?.entity?.notes || data.payload?.payment?.entity?.notes || {};
    const orgId = notes.org_id;
    let plan: PlanType | undefined;

    if (event === 'subscription.activated' || event === 'subscription.charged') {
      plan = (notes.plan || 'pro') as PlanType;
      if (orgId && plan) {
        await db.update(orgs).set({ plan, subscriptionStatus: 'active', updatedAt: new Date() }).where(eq(orgs.id, orgId));
      }
    } else if (event === 'subscription.cancelled' || event === 'subscription.halted') {
      if (orgId) {
        await db.update(orgs).set({ plan: 'free', subscriptionStatus: 'canceled', updatedAt: new Date() }).where(eq(orgs.id, orgId));
      }
    }

    return {
      event,
      orgId,
      plan,
    };
  }
}
