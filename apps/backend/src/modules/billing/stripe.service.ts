import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe;

  constructor() {
    if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2026-02-25.clover',
      });
    }
  }

  private get client(): Stripe {
    if (!this.stripe) throw new BadRequestException('Stripe is not configured');
    return this.stripe;
  }

  // ── Create or get customer ────────────────────────────────
  async getOrCreateCustomer(email: string, name: string, metadata: Record<string, string> = {}): Promise<string> {
    const existing = await this.client.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) return existing.data[0].id;

    const customer = await this.client.customers.create({ email, name, metadata });
    return customer.id;
  }

  // ── Create checkout session ───────────────────────────────
  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    organizationId: string;
    successUrl: string;
    cancelUrl: string;
    couponCode?: string;
    trialDays?: number;
  }): Promise<string> {
    const session = await this.client.checkout.sessions.create({
      customer: params.customerId,
      payment_method_types: ['card'],
      line_items: [{ price: params.priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { organizationId: params.organizationId },
      ...(params.couponCode && {
        discounts: [{ coupon: params.couponCode }],
      }),
      ...(params.trialDays && {
        subscription_data: { trial_period_days: params.trialDays },
      }),
      automatic_tax: { enabled: process.env.STRIPE_TAX_ENABLED === 'true' },
      customer_update: { address: 'auto' },
    });

    return session.url!;
  }

  // ── Create billing portal session ─────────────────────────
  async createPortalSession(customerId: string, returnUrl: string): Promise<string> {
    const session = await this.client.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  // ── Cancel subscription ───────────────────────────────────
  async cancelSubscription(subscriptionId: string, atPeriodEnd = true) {
    return this.client.subscriptions.update(subscriptionId, {
      cancel_at_period_end: atPeriodEnd,
    });
  }

  // ── Verify webhook signature ──────────────────────────────
  verifyWebhook(payload: Buffer, signature: string): Stripe.Event {
    return this.client.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_SIGNING_KEY!,
    );
  }

  // ── Get subscription ──────────────────────────────────────
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.client.subscriptions.retrieve(subscriptionId);
  }

  // ── Get invoice ───────────────────────────────────────────
  async getInvoice(invoiceId: string) {
    return this.client.invoices.retrieve(invoiceId);
  }

  // ── List invoices for customer ────────────────────────────
  async listInvoices(customerId: string) {
    return this.client.invoices.list({ customer: customerId, limit: 24 });
  }

  // ── Validate coupon ───────────────────────────────────────
  async validateCoupon(code: string) {
    try {
      const coupon = await this.client.coupons.retrieve(code);
      return { valid: coupon.valid, coupon };
    } catch {
      return { valid: false, coupon: null };
    }
  }
}
