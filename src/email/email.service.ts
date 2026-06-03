import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

const BRAND = 'Kriyava SMM';
const PANEL_URL = 'https://smm.kriyava.com';
const ACCENT = '#2563EB';

function layout(title: string, body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b}
  .wrap{max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .hd{background:${ACCENT};padding:28px 32px;text-align:center}
  .hd h1{color:#fff;font-size:20px;font-weight:800;margin:0;letter-spacing:-.3px}
  .hd p{color:rgba(255,255,255,.8);font-size:13px;margin:6px 0 0}
  .bd{padding:32px}
  .bd h2{font-size:17px;font-weight:700;margin:0 0 12px;color:#0f172a}
  .bd p{font-size:14px;line-height:1.7;color:#475569;margin:0 0 14px}
  .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin:16px 0}
  .card-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
  .card-row:last-child{border-bottom:none}
  .card-row .lbl{color:#64748b;font-weight:600}
  .card-row .val{color:#0f172a;font-weight:700}
  .val-green{color:#16a34a!important}
  .val-blue{color:${ACCENT}!important}
  .btn{display:inline-block;background:${ACCENT};color:#fff!important;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;text-decoration:none;margin:8px 0}
  .ft{background:#f8fafc;padding:20px 32px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9}
  .ft a{color:${ACCENT};text-decoration:none;font-weight:600}
  .badge{display:inline-block;background:rgba(37,99,235,.1);color:${ACCENT};font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;letter-spacing:.04em;text-transform:uppercase}
</style></head>
<body><div class="wrap">
  <div class="hd"><h1>${BRAND}</h1><p>${title}</p></div>
  <div class="bd">${body}</div>
  <div class="ft">© ${new Date().getFullYear()} ${BRAND} · <a href="${PANEL_URL}">${PANEL_URL}</a><br>You're receiving this because you have an account at Kriyava SMM.</div>
</div></body></html>`;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get<string>('SMTP_PORT') || 587),
        secure: this.config.get<string>('SMTP_PORT') === '465',
        auth: { user, pass },
      });
      this.logger.log(`Email service ready (${host})`);
    } else {
      this.logger.warn('SMTP not configured — emails disabled. Set SMTP_HOST/USER/PASS in env.');
    }
  }

  private async send(to: string, subject: string, html: string) {
    if (!this.transporter) return;
    const from = this.config.get<string>('FROM_EMAIL') || `${BRAND} <noreply@kriyava.com>`;
    try {
      await this.transporter.sendMail({ from, to, subject, html });
    } catch (err) {
      this.logger.warn(`Email to ${to} failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  async sendWelcome(to: string, name: string, referralCode: string) {
    const html = layout('Welcome to Kriyava SMM!', `
      <h2>Welcome, ${name}! 🎉</h2>
      <p>Your Kriyava SMM account is ready. Grow any social media account with our auto-routed multi-provider panel.</p>
      <div class="card">
        <div class="card-row"><span class="lbl">Your Referral Code</span><span class="val val-blue">${referralCode}</span></div>
        <div class="card-row"><span class="lbl">Referral Link</span><span class="val"><a href="${PANEL_URL}/login?ref=${referralCode}" style="color:${ACCENT}">${PANEL_URL}/login?ref=${referralCode}</a></span></div>
        <div class="card-row"><span class="lbl">Referral Bonus</span><span class="val val-green">Earn 5% when friends add funds</span></div>
      </div>
      <p>Start by adding funds to your wallet and placing your first order.</p>
      <a href="${PANEL_URL}/add-funds" class="btn">Add Funds → Start Growing</a>
    `);
    await this.send(to, `Welcome to ${BRAND}! 🚀`, html);
  }

  async sendLoginAlert(to: string, name: string) {
    const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const html = layout('New Login Detected', `
      <h2>New login to your account</h2>
      <p>Hi ${name}, a new login was detected on your Kriyava SMM account.</p>
      <div class="card">
        <div class="card-row"><span class="lbl">Time (IST)</span><span class="val">${time}</span></div>
        <div class="card-row"><span class="lbl">Platform</span><span class="val">Kriyava SMM Panel</span></div>
      </div>
      <p>If this was you, no action needed. If you didn't log in, <a href="${PANEL_URL}/settings" style="color:${ACCENT}">secure your account immediately</a>.</p>
    `);
    await this.send(to, `New login to your ${BRAND} account`, html);
  }

  async sendFundAdded(to: string, name: string, amount: number, newBalance: number) {
    const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const html = layout('Funds Added Successfully', `
      <h2>Payment successful! ✅</h2>
      <p>Hi ${name}, your Kriyava wallet has been topped up.</p>
      <div class="card">
        <div class="card-row"><span class="lbl">Amount Added</span><span class="val val-green">${fmt(amount)}</span></div>
        <div class="card-row"><span class="lbl">New Wallet Balance</span><span class="val val-blue">${fmt(newBalance)}</span></div>
        <div class="card-row"><span class="lbl">Payment Method</span><span class="val">Razorpay (Verified)</span></div>
      </div>
      <a href="${PANEL_URL}/new-order" class="btn">Place an Order Now</a>
    `);
    await this.send(to, `${fmt(amount)} added to your ${BRAND} wallet ✅`, html);
  }

  async sendOrderPlaced(to: string, name: string, orderId: string, service: string, qty: number, charge: number, provider: string) {
    const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const html = layout('Order Placed Successfully', `
      <h2>Your order is being processed 🚀</h2>
      <p>Hi ${name}, your campaign has been placed and is being routed to our provider network.</p>
      <div class="card">
        <div class="card-row"><span class="lbl">Order ID</span><span class="val">…${orderId.slice(-8)}</span></div>
        <div class="card-row"><span class="lbl">Service</span><span class="val">${service.slice(0, 60)}</span></div>
        <div class="card-row"><span class="lbl">Quantity</span><span class="val">${qty.toLocaleString()}</span></div>
        <div class="card-row"><span class="lbl">Charged</span><span class="val val-blue">${fmt(charge)}</span></div>
        <div class="card-row"><span class="lbl">Provider</span><span class="val">${provider}</span></div>
        <div class="card-row"><span class="lbl">Status</span><span class="val val-green">Processing</span></div>
      </div>
      <a href="${PANEL_URL}/orders" class="btn">Track Your Orders</a>
    `);
    await this.send(to, `Order placed: ${service.slice(0, 40)} — ${BRAND}`, html);
  }

  async sendApiKey(to: string, name: string, apiKey: string) {
    const html = layout('Your API Key', `
      <h2>Your Kriyava API Key 🔑</h2>
      <p>Hi ${name}, here is your API key for programmatic access to Kriyava SMM.</p>
      <div class="card">
        <div class="card-row"><span class="lbl">API Key</span><span class="val val-blue" style="font-family:monospace;font-size:12px;word-break:break-all">${apiKey}</span></div>
        <div class="card-row"><span class="lbl">API Endpoint</span><span class="val" style="font-family:monospace;font-size:11px">https://kriyava-api-82kg9.ondigitalocean.app/api/v2</span></div>
      </div>
      <p><strong>Keep this key private.</strong> Never share it publicly. You can regenerate it from your Settings page.</p>
      <a href="${PANEL_URL}/api-docs" class="btn">View API Documentation</a>
    `);
    await this.send(to, `Your ${BRAND} API Key`, html);
  }

  async sendReferralEarned(to: string, name: string, earned: number, totalEarned: number) {
    const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const html = layout('Referral Bonus Earned!', `
      <h2>You earned a referral bonus! 🎊</h2>
      <p>Hi ${name}, someone you referred just added funds and you earned a 5% cashback!</p>
      <div class="card">
        <div class="card-row"><span class="lbl">Bonus Earned</span><span class="val val-green">${fmt(earned)}</span></div>
        <div class="card-row"><span class="lbl">Total Referral Earnings</span><span class="val val-blue">${fmt(totalEarned)}</span></div>
      </div>
      <p>The bonus has been credited to your wallet. Keep sharing your referral link to earn more!</p>
      <a href="${PANEL_URL}/settings" class="btn">See My Referral Link</a>
    `);
    await this.send(to, `Referral bonus: ${fmt(earned)} added to your wallet! 🎊`, html);
  }
}
