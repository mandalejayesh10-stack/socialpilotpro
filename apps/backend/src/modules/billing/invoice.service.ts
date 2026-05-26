import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  private readonly invoiceDir = path.join(process.cwd(), 'reports', 'invoices');

  constructor(private prisma: PrismaService) {
    if (!fs.existsSync(this.invoiceDir)) {
      fs.mkdirSync(this.invoiceDir, { recursive: true });
    }
  }

  async getInvoices(organizationId: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { issuedAt: 'desc' },
      take: 24,
    });
  }

  async generateInvoicePdf(organizationId: string, invoiceId: string): Promise<string> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { organization: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    // Use puppeteer for PDF generation
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(this.buildInvoiceHtml(invoice), { waitUntil: 'networkidle0' });

      const filename = `invoice_${invoice.invoiceNumber.replace(/[^a-z0-9]/gi, '_')}.pdf`;
      const outputPath = path.join(this.invoiceDir, filename);

      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      });

      const pdfUrl = `/api/billing/invoices/${invoiceId}/pdf/download`;

      // Update invoice with PDF URL
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { pdfUrl },
      });

      return pdfUrl;
    } finally {
      await browser.close();
    }
  }

  async getInvoicePdfFile(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const filename = invoice.pdfUrl?.startsWith('/api/billing/')
      ? `invoice_${invoice.invoiceNumber.replace(/[^a-z0-9]/gi, '_')}.pdf`
      : path.basename(invoice.pdfUrl || '');
    const fullPath = path.resolve(this.invoiceDir, filename);
    if (!fullPath.startsWith(path.resolve(this.invoiceDir)) || !fs.existsSync(fullPath)) {
      throw new NotFoundException('Invoice PDF not found');
    }
    return { fullPath, filename };
  }

  async createInvoice(data: {
    organizationId: string;
    paymentId: string;
    amount: number;
    taxAmount: number;
    currency: string;
    taxRate: number;
    taxType?: string;
    taxCountry?: string;
  }): Promise<any> {
    const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    return this.prisma.invoice.create({
      data: {
        organizationId: data.organizationId,
        paymentId: data.paymentId,
        invoiceNumber,
        amount: data.amount,
        taxAmount: data.taxAmount,
        totalAmount: data.amount + data.taxAmount,
        currency: data.currency,
        taxRate: data.taxRate,
        taxType: data.taxType,
        taxCountry: data.taxCountry,
        companyName: process.env.COMPANY_NAME || 'SocialPilot Pro',
        companyAddress: process.env.COMPANY_ADDRESS || '',
      },
    });
  }

  private buildInvoiceHtml(invoice: any): string {
    const fmt = (n: number) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: invoice.currency?.toUpperCase() || 'USD',
      }).format(n / 100);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
    .logo { font-size: 24px; font-weight: 700; color: #6366f1; }
    .invoice-meta { text-align: right; }
    .invoice-meta h2 { font-size: 28px; color: #6366f1; margin-bottom: 8px; }
    .invoice-meta p { color: #666; font-size: 14px; }
    .divider { border: none; border-top: 2px solid #f0f0f0; margin: 24px 0; }
    .section { margin-bottom: 24px; }
    .section h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 8px; }
    .section p { font-size: 14px; color: #333; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th { background: #f8f9ff; padding: 12px 16px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }
    td { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .totals { margin-top: 16px; }
    .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #666; }
    .total-final { font-size: 18px; font-weight: 700; color: #1a1a2e; border-top: 2px solid #6366f1; padding-top: 12px; margin-top: 8px; }
    .footer { margin-top: 48px; text-align: center; color: #999; font-size: 12px; }
    .badge { display: inline-block; background: #22c55e; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">⚡ SocialPilot Pro</div>
      <p style="color:#666;font-size:13px;margin-top:4px">${process.env.COMPANY_EMAIL || 'support@socialpilotpro.com'}</p>
    </div>
    <div class="invoice-meta">
      <h2>INVOICE</h2>
      <p><strong>${invoice.invoiceNumber}</strong></p>
      <p>Issued: ${new Date(invoice.issuedAt).toLocaleDateString()}</p>
      <p style="margin-top:8px"><span class="badge">PAID</span></p>
    </div>
  </div>

  <hr class="divider">

  <div style="display:flex;gap:48px;margin-bottom:32px">
    <div class="section">
      <h3>Billed To</h3>
      <p><strong>${invoice.organization?.name || 'Customer'}</strong></p>
      ${invoice.vatNumber ? `<p>VAT: ${invoice.vatNumber}</p>` : ''}
    </div>
    <div class="section">
      <h3>Payment Details</h3>
      <p>Currency: ${invoice.currency?.toUpperCase()}</p>
      ${invoice.taxCountry ? `<p>Country: ${invoice.taxCountry}</p>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>SocialPilot Pro Subscription</td>
        <td style="text-align:right">${fmt(invoice.amount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals" style="max-width:280px;margin-left:auto;margin-top:16px">
    <div class="total-row">
      <span>Subtotal</span>
      <span>${fmt(invoice.amount)}</span>
    </div>
    ${invoice.taxAmount > 0 ? `
    <div class="total-row">
      <span>${invoice.taxType || 'Tax'} (${invoice.taxRate}%)</span>
      <span>${fmt(invoice.taxAmount)}</span>
    </div>` : ''}
    <div class="total-row total-final">
      <span>Total</span>
      <span>${fmt(invoice.totalAmount)}</span>
    </div>
  </div>

  <div class="footer">
    <p>Thank you for your business!</p>
    <p style="margin-top:4px">Questions? Contact ${process.env.COMPANY_EMAIL || 'support@socialpilotpro.com'}</p>
  </div>
</body>
</html>`;
  }
}
