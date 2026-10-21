import { BillingProvider, CheckoutSessionParams, CustomerPortalParams, SubscriptionInfo, WebhookResult, PlanType } from './types.js';
import { db } from '../db/client.js';
import { orgs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { env } from '../env.js';

export class LemonSqueezyBillingProvider implements BillingProvider {
  private apiKey: string;
  private storeId: string;

  constructor(
    apiKey: string = process.env.LEMONSQUEEZY_API_KEY || process.env.LEMON_SQUEEZY_API_KEY || env.LEMONSQUEEZY_API_KEY || '',
    storeId: string = process.env.LEMONSQUEEZY_STORE_ID || process.env.LEMON_SQUEEZY_STORE_ID || env.LEMONSQUEEZY_STORE_ID || ''
  ) {
    this.apiKey = apiKey;
    this.storeId = storeId;
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string; sessionId: string }> {
    const { orgId, plan, successUrl, cancelUrl } = params;

    // 1. If API Key and Store ID are set, create dynamic checkout via Lemon Squeezy API
    if (this.apiKey && this.storeId) {
      const variantId = plan === 'team'
        ? (process.env.LEMONSQUEEZY_VARIANT_TEAM || env.LEMONSQUEEZY_VARIANT_TEAM || '')
        : (process.env.LEMONSQUEEZY_VARIANT_PRO || env.LEMONSQUEEZY_VARIANT_PRO || '');

      if (variantId) {
        try {
          const res = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/vnd.api+json',
              Accept: 'application/vnd.api+json',
            },
            body: JSON.stringify({
              data: {
                type: 'checkouts',
                attributes: {
                  checkout_data: {
                    custom: {
                      org_id: orgId,
                      plan,
                    },
                  },
                  product_options: {
                    redirect_url: successUrl,
                  },
                },
                relationships: {
                  store: {
                    data: {
                      type: 'stores',
                      id: this.storeId,
                    },
                  },
                  variant: {
                    data: {
                      type: 'variants',
                      id: variantId,
                    },
                  },
                },
              },
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const checkoutUrl = data.data?.attributes?.url;
            const checkoutId = data.data?.id || `lemon_${Date.now()}`;
            if (checkoutUrl) {
              return {
                url: checkoutUrl,
                sessionId: checkoutId,
              };
            }
          } else {
            const errText = await res.text();
            console.error('[LemonSqueezy] Checkout creation API error:', errText);
          }
        } catch (err) {
          console.error('[LemonSqueezy] Network error calling checkouts API:', err);
        }
      }
    }

    // 2. Direct hosted checkout URL if store slug and variant provided
    const storeSlug = process.env.LEMONSQUEEZY_STORE_SLUG || env.LEMONSQUEEZY_STORE_SLUG;
    const variantId = plan === 'team'
      ? (process.env.LEMONSQUEEZY_VARIANT_TEAM || env.LEMONSQUEEZY_VARIANT_TEAM)
      : (process.env.LEMONSQUEEZY_VARIANT_PRO || env.LEMONSQUEEZY_VARIANT_PRO);

    if (storeSlug && variantId) {
      const hostedUrl = `https://${storeSlug}.lemonsqueezy.com/buy/${variantId}?checkout[custom][org_id]=${orgId}&checkout[custom][plan]=${plan}&checkout[success_url]=${encodeURIComponent(successUrl)}`;
      return {
        url: hostedUrl,
        sessionId: `lemon_variant_${variantId}`,
      };
    }

    // 3. Fallback for test/dev
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

    const eventName = data.meta?.event_name || data.event_name || 'unknown';
    const orgId =
      data.meta?.custom_data?.org_id ||
      data.data?.attributes?.first_order_item?.order_id ||
      data.data?.attributes?.checkout_data?.custom?.org_id;

    let plan: PlanType | undefined;

    if (
      eventName === 'order_created' ||
      eventName === 'subscription_created' ||
      eventName === 'subscription_updated' ||
      eventName === 'subscription_resumed'
    ) {
      plan = (data.meta?.custom_data?.plan || data.data?.attributes?.checkout_data?.custom?.plan || 'pro') as PlanType;
      const renewsAtStr = data.data?.attributes?.renews_at || data.data?.attributes?.ends_at;
      const currentPeriodEnd = renewsAtStr ? new Date(renewsAtStr) : undefined;

      if (orgId && plan) {
        await db
          .update(orgs)
          .set({
            plan,
            subscriptionStatus: 'active',
            ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
            updatedAt: new Date(),
          })
          .where(eq(orgs.id, orgId));
      }
    } else if (
      eventName === 'subscription_cancelled' ||
      eventName === 'subscription_expired' ||
      eventName === 'subscription_paused'
    ) {
      if (orgId) {
        await db
          .update(orgs)
          .set({
            plan: 'free',
            subscriptionStatus: 'canceled',
            updatedAt: new Date(),
          })
          .where(eq(orgs.id, orgId));
      }
    }

    return {
      event: eventName,
      orgId,
      plan,
    };
  }
}
