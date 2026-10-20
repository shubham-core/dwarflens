export type PlanType = 'free' | 'pro' | 'team';

export interface PlanLimits {
  maxProjects: number | 'unlimited';
  allowPrivateRepos: boolean;
  retentionDays: number | 'unlimited';
  allowAlerts: boolean;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxProjects: 1,
    allowPrivateRepos: false,
    retentionDays: 30,
    allowAlerts: false,
  },
  pro: {
    maxProjects: 'unlimited',
    allowPrivateRepos: true,
    retentionDays: 365,
    allowAlerts: true,
  },
  team: {
    maxProjects: 'unlimited',
    allowPrivateRepos: true,
    retentionDays: 'unlimited',
    allowAlerts: true,
  },
};

export interface CheckoutSessionParams {
  orgId: string;
  plan: PlanType;
  successUrl: string;
  cancelUrl: string;
}

export interface CustomerPortalParams {
  orgId: string;
  returnUrl: string;
}

export interface SubscriptionInfo {
  plan: PlanType;
  status: 'active' | 'past_due' | 'canceled' | 'none';
  currentPeriodEnd?: Date;
}

export interface WebhookResult {
  event: string;
  orgId?: string;
  plan?: PlanType;
}

export interface BillingProvider {
  createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string; sessionId: string }>;
  createCustomerPortalSession(params: CustomerPortalParams): Promise<{ url: string }>;
  getSubscription(orgId: string): Promise<SubscriptionInfo>;
  handleWebhook(payload: string, signature: string): Promise<WebhookResult>;
}
