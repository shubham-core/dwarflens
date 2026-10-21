import { BillingProvider, CheckoutSessionParams, CustomerPortalParams, SubscriptionInfo, WebhookResult, PlanType } from './types.js';
import { db } from '../db/client.js';
import { orgs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { env } from '../env.js';

export class RazorpayBillingProvider implements BillingProvider {
  private keyId: string;
  private keySecret: string;

  constructor(
    keyId: string = process.env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID || '',
    keySecret: string = process.env.RAZORPAY_KEY_SECRET || env.RAZORPAY_KEY_SECRET || ''
  ) {
    this.keyId = keyId;
    this.keySecret = keySecret;
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string; sessionId: string }> {
    const { orgId, plan, successUrl, cancelUrl } = params;

    if (this.keyId && this.keySecret) {
      // Call Razorpay API to create Payment Link
      const currency = (process.env.RAZORPAY_CURRENCY || env.RAZORPAY_CURRENCY || 'USD').toUpperCase();
      let amountInSubunits: number;
      if (currency === 'INR') {
        amountInSubunits = plan === 'team' ? 399900 : 149900; // ₹3999 or ₹1499 in paise
      } else {
        amountInSubunits = plan === 'team' ? 4900 : 1900; // $49 or $19 in cents
      }

      const authHeader = 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
      try {
        const res = await fetch('https://api.razorpay.com/v1/payment_links', {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amountInSubunits,
            currency,
            description: `DwarfLens ${plan.toUpperCase()} Plan Subscription`,
            callback_url: successUrl,
            callback_method: 'get',
            notes: {
              org_id: orgId,
              plan,
            },
          }),
        });

        if (res.ok) {
          const linkData = await res.json();
          return {
            url: linkData.short_url,
            sessionId: linkData.id,
          };
        } else {
          const errText = await res.text();
          console.error('[Razorpay] Failed to create payment link:', errText);
        }
      } catch (err) {
        console.error('[Razorpay] Error calling payment links API:', err);
      }
    }

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
    const notes =
      data.payload?.payment_link?.entity?.notes ||
      data.payload?.subscription?.entity?.notes ||
      data.payload?.payment?.entity?.notes ||
      data.payload?.order?.entity?.notes ||
      {};
    const orgId = notes.org_id;
    let plan: PlanType | undefined;

    if (
      event === 'subscription.activated' ||
      event === 'subscription.charged' ||
      event === 'payment_link.paid' ||
      event === 'payment.captured' ||
      event === 'order.paid'
    ) {
      plan = (notes.plan || 'pro') as PlanType;
      if (orgId && plan) {
        await db.update(orgs).set({ plan, subscriptionStatus: 'active', updatedAt: new Date() }).where(eq(orgs.id, orgId));
      }
    } else if (
      event === 'subscription.cancelled' ||
      event === 'subscription.halted' ||
      event === 'payment.failed'
    ) {
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
