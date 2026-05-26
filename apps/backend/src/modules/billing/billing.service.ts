import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { StripeService } from './stripe.service';
import { FeatureGateService, PLAN_LIMITS } from './feature-gate.service';
import { InvoiceService } from './invoice.service';
import { SubscriptionTier, Period } from '@prisma/client';

const PRICE_MAP: Record<string, Record<string, string>> = {
  PRO: {
    MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
    YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY || '',
  },
  AGENCY: {
    MONTHLY: process.env.STRIPE_PRICE_AGENCY_MONTHLY || '',
    YEARLY: process.env.STRIPE_PRICE_AGENCY_YEARLY || '',
  },
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private stripe: StripeService,
    private featureGate: FeatureGateService,
    private invoiceService: InvoiceService,
  ) {}

  // ── Get current subscription ──────────────────────────────
  async getSubscription(organizationId: string) {
    const [sub, usage] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { organizationId } }),
      this.prisma.usageLimits.findUnique({ where: { organizationId } }),
    ]);

    const tier = sub?.tier || 'FREE';
    const limits = PLAN_LIMITS[tier];

    return {
      subscription: sub,
      usage,
      limits,
      tier,
    };
  }

  // ── Create checkout session ───────────────────────────────
  async createCheckout(params: {
    organizationId: string;
    userEmail: string;
    userName: string;
    tier: SubscriptionTier;
    period: Period;
    couponCode?: string;
  }) {
    const priceId = PRICE_MAP[params.tier]?.[params.period];
    if (!priceId) throw new NotFoundException('Price not configured for this plan');

    const customerId = await this.stripe.getOrCreateCustomer(
      params.userEmail,
      params.userName,
      { organizationId: params.organizationId },
    );

    const url = await this.stripe.createCheckoutSession({
      customerId,
      priceId,
      organizationId: params.organizationId,
      successUrl: `${process.env.FRONTEND_URL}/billing?success=true`,
      cancelUrl: `${process.env.FRONTEND_URL}/billing?cancelled=true`,
      couponCode: params.couponCode,
    });

    return { url };
  }

  // ── Billing portal ────────────────────────────────────────
  async getBillingPortal(organizationId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (!sub?.customerId) throw new NotFoundException('No billing account found');

    const url = await this.stripe.createPortalSession(
      sub.customerId,
      `${process.env.FRONTEND_URL}/billing`,
    );
    return { url };
  }

  // ── Handle Stripe webhook ─────────────────────────────────
  async handleStripeWebhook(payload: Buffer, signature: string) {
    const event = this.stripe.verifyWebhook(payload, signature);
    this.logger.log(`Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as any);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as any);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as any);
        break;
      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object as any);
        break;
      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as any);
        break;
    }

    return { received: true };
  }

  // ── Webhook handlers ──────────────────────────────────────
  private async handleCheckoutCompleted(session: any) {
    const organizationId = session.metadata?.organizationId;
    if (!organizationId) return;

    const subscription = await this.stripe.getSubscription(session.subscription);
    const billingPeriod = this.getSubscriptionPeriod(subscription);
    const tier = this.getTierFromPriceId(subscription.items.data[0].price.id);

    await this.prisma.subscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        tier,
        status: 'ACTIVE',
        provider: 'STRIPE',
        externalId: subscription.id,
        customerId: session.customer,
        period: subscription.items.data[0].price.recurring?.interval === 'year' ? 'YEARLY' : 'MONTHLY',
        currentPeriodStart: billingPeriod.start,
        currentPeriodEnd: billingPeriod.end,
        amount: subscription.items.data[0].price.unit_amount || 0,
        currency: subscription.currency,
      },
      update: {
        tier,
        status: 'ACTIVE',
        externalId: subscription.id,
        customerId: session.customer,
        currentPeriodStart: billingPeriod.start,
        currentPeriodEnd: billingPeriod.end,
      },
    });

    // Update usage limits based on new tier
    await this.updateUsageLimitsForTier(organizationId, tier);
  }

  private async handleSubscriptionUpdated(subscription: any) {
    const existing = await this.prisma.subscription.findFirst({
      where: { externalId: subscription.id },
    });
    if (!existing) return;

    const tier = this.getTierFromPriceId(subscription.items.data[0].price.id);
    const status = this.mapStripeStatus(subscription.status);
    const billingPeriod = this.getSubscriptionPeriod(subscription);

    await this.prisma.subscription.update({
      where: { id: existing.id },
      data: {
        tier,
        status,
        currentPeriodStart: billingPeriod.start,
        currentPeriodEnd: billingPeriod.end,
        cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
      },
    });

    await this.updateUsageLimitsForTier(existing.organizationId, tier);
  }

  private async handleSubscriptionDeleted(subscription: any) {
    await this.prisma.subscription.updateMany({
      where: { externalId: subscription.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  private getSubscriptionPeriod(subscription: any) {
    const item = subscription.items?.data?.[0];
    const start = item?.current_period_start || subscription.current_period_start || subscription.created || Math.floor(Date.now() / 1000);
    const end = item?.current_period_end || subscription.current_period_end || subscription.cancel_at || start;
    return {
      start: new Date(start * 1000),
      end: new Date(end * 1000),
    };
  }

  private async handlePaymentSucceeded(invoice: any) {
    const existing = await this.prisma.subscription.findFirst({
      where: { externalId: invoice.subscription },
    });
    if (!existing) return;

    // Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        organizationId: existing.organizationId,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: 'SUCCESS',
        provider: 'STRIPE',
        externalId: invoice.payment_intent,
        description: `Subscription payment - ${invoice.billing_reason}`,
        taxAmount: invoice.tax || 0,
        taxRate: invoice.tax_percent || 0,
      },
    });

    // Auto-generate invoice PDF record
    await this.invoiceService.createInvoice({
      organizationId: existing.organizationId,
      paymentId: payment.id,
      amount: invoice.amount_paid - (invoice.tax || 0),
      taxAmount: invoice.tax || 0,
      currency: invoice.currency,
      taxRate: invoice.tax_percent || 0,
      taxType: invoice.customer_tax_ids?.[0]?.type,
      taxCountry: invoice.customer_address?.country,
    });
  }

  private async handlePaymentFailed(invoice: any) {
    const existing = await this.prisma.subscription.findFirst({
      where: { externalId: invoice.subscription },
    });
    if (!existing) return;

    await this.prisma.subscription.update({
      where: { id: existing.id },
      data: {
        status: 'PAST_DUE',
        gracePeriodEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────
  private getTierFromPriceId(priceId: string): SubscriptionTier {
    if (priceId === PRICE_MAP.AGENCY?.MONTHLY || priceId === PRICE_MAP.AGENCY?.YEARLY) {
      return 'AGENCY';
    }
    if (priceId === PRICE_MAP.PRO?.MONTHLY || priceId === PRICE_MAP.PRO?.YEARLY) {
      return 'PRO';
    }
    return 'FREE';
  }

  private mapStripeStatus(status: string): any {
    const map: Record<string, string> = {
      active: 'ACTIVE',
      canceled: 'CANCELLED',
      past_due: 'PAST_DUE',
      trialing: 'TRIALING',
      unpaid: 'PAST_DUE',
    };
    return map[status] || 'ACTIVE';
  }

  private async updateUsageLimitsForTier(organizationId: string, tier: SubscriptionTier) {
    const limits = PLAN_LIMITS[tier];
    await this.prisma.usageLimits.upsert({
      where: { organizationId },
      create: {
        organizationId,
        postsLimit: limits.postsPerMonth,
        accountsLimit: limits.accounts,
        reportsLimit: limits.reports,
        aiCreditsLimit: limits.aiCredits,
        teamMembersLimit: limits.teamMembers,
      },
      update: {
        postsLimit: limits.postsPerMonth,
        accountsLimit: limits.accounts,
        reportsLimit: limits.reports,
        aiCreditsLimit: limits.aiCredits,
        teamMembersLimit: limits.teamMembers,
      },
    });
  }
}
