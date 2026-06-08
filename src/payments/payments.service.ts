import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { WalletService } from '../wallet/wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

const MIN_TOPUP = 10;

@Injectable()
export class PaymentsService {
  private rzp: Razorpay | null = null;

  constructor(
    private wallet: WalletService,
    private prisma: PrismaService,
    private email: EmailService,
  ) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (keyId && keySecret) {
      this.rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
  }

  isConfigured() {
    return Boolean(this.rzp);
  }

  /** Step 1: create a Razorpay order the browser checkout opens. */
  async createOrder(amount: number) {
    if (!this.rzp) throw new ServiceUnavailableException('Payments not configured');
    if (!amount || amount < MIN_TOPUP) {
      throw new BadRequestException(`Minimum top-up is ₹${MIN_TOPUP}`);
    }
    const order = await this.rzp.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: 'INR',
      receipt: 'kriyava_' + Date.now(),
      notes: { purpose: 'wallet_topup' },
    });
    return {
      orderId: order.id,
      amount: Number(order.amount) / 100,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    };
  }

  /** Step 2: verify the signature Razorpay returns, then credit the wallet. */
  async verify(
    userId: string,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ) {
    if (!this.rzp) throw new ServiceUnavailableException('Payments not configured');
    const secret = process.env.RAZORPAY_KEY_SECRET as string;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
    if (expected !== razorpaySignature) {
      throw new BadRequestException('Payment verification failed');
    }
    // fetch the captured amount from Razorpay (don't trust the client)
    const payment = await this.rzp.payments.fetch(razorpayPaymentId);
    const amount = Number(payment.amount) / 100;
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      throw new BadRequestException('Payment not completed');
    }
    // `razorpayPaymentId` is the idempotency key — a replayed verify hits the unique
    // constraint and returns duplicate:true instead of crediting (and paying cashback) twice.
    const result = await this.wallet.credit(userId, amount, 'Razorpay', razorpayPaymentId, razorpayPaymentId);
    if (result.duplicate) {
      return { added: 0, balance: result.balance, alreadyProcessed: true };
    }

    // Fire-and-forget: send email + handle referral cashback (only on the first, real credit)
    void this.postPayment(userId, amount, result.balance);

    return result;
  }

  private async postPayment(userId: string, amount: number, newBalance: number) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return;

      // Send fund-added email
      void this.email.sendFundAdded(user.email, user.name, amount, newBalance);

      // Referral cashback: 5% to referrer
      if (user.referredBy) {
        const cashback = +(amount * 0.05).toFixed(4);
        if (cashback < 0.01) return;
        const referrer = await this.prisma.user.findUnique({ where: { id: user.referredBy } });
        if (!referrer) return;

        await this.prisma.$transaction([
          this.prisma.user.update({ where: { id: referrer.id }, data: { balance: { increment: cashback }, referralEarned: { increment: cashback } } }),
          this.prisma.transaction.create({ data: { userId: referrer.id, type: 'Referral', amount: cashback, method: 'Referral', note: `5% cashback from ${user.name}` } }),
        ]);

        const updatedReferrer = await this.prisma.user.findUnique({ where: { id: referrer.id } });
        void this.email.sendReferralEarned(referrer.email, referrer.name, cashback, Number(updatedReferrer?.referralEarned ?? cashback));
      }
    } catch {
      /* never let cashback errors surface */
    }
  }
}
