import {
  Controller, Get, Post, Body, UseGuards, RawBodyRequest, Req, Headers, Param, Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { Response } from 'express';
import { BillingService } from './billing.service';
import { InvoiceService } from './invoice.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, CurrentOrg } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Period, SubscriptionTier } from '@prisma/client';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(
    private billingService: BillingService,
    private invoiceService: InvoiceService,
  ) {}

  @Get('subscription')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgMemberGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Get current subscription and usage' })
  async getSubscription(@CurrentOrg() org: any) {
    return this.billingService.getSubscription(org.id);
  }

  @Post('checkout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgMemberGuard, PermissionsGuard)
  @RequirePermissions('billing:write')
  @ApiOperation({ summary: 'Create Stripe checkout session' })
  async createCheckout(
    @CurrentUser() user: any,
    @CurrentOrg() org: any,
    @Body() body: { tier: SubscriptionTier; period: Period; couponCode?: string },
  ) {
    return this.billingService.createCheckout({
      organizationId: org.id,
      userEmail: user.email,
      userName: user.name || user.email,
      tier: body.tier,
      period: body.period,
      couponCode: body.couponCode,
    });
  }

  @Post('portal')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgMemberGuard, PermissionsGuard)
  @RequirePermissions('billing:write')
  @ApiOperation({ summary: 'Open Stripe billing portal' })
  async getBillingPortal(@CurrentOrg() org: any) {
    return this.billingService.getBillingPortal(org.id);
  }

  @Get('invoices')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgMemberGuard, PermissionsGuard)
  @ApiOperation({ summary: 'List invoices' })
  async getInvoices(@CurrentOrg() org: any) {
    return this.invoiceService.getInvoices(org.id);
  }

  @Post('invoices/:id/pdf')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgMemberGuard, PermissionsGuard)
  @RequirePermissions('billing:write')
  @ApiOperation({ summary: 'Generate invoice PDF' })
  async generateInvoicePdf(@CurrentOrg() org: any, @Param('id') id: string) {
    const url = await this.invoiceService.generateInvoicePdf(org.id, id);
    return { url };
  }

  @Get('invoices/:id/pdf/download')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgMemberGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Download invoice PDF' })
  async downloadInvoicePdf(@CurrentOrg() org: any, @Param('id') id: string, @Res() res: Response) {
    const file = await this.invoiceService.getInvoicePdfFile(org.id, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return res.sendFile(file.fullPath);
  }

  @Public()
  @Post('webhook/stripe')
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.billingService.handleStripeWebhook(req.rawBody!, signature);
  }
}
