import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from '../services/services.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private services: ServicesService,
    private email: EmailService,
  ) {}

  private shape(o: {
    id: string;
    serviceId: string;
    serviceName: string;
    platform: string | null;
    link: string;
    quantity: number;
    charge: unknown;
    status: string;
    provider: string;
    providerOrderId?: string | null;
    createdAt: Date;
  }) {
    return {
      id: o.id,
      serviceId: o.serviceId,
      service: o.serviceName,
      platform: o.platform,
      link: o.link,
      qty: o.quantity,
      charge: Number(o.charge),
      status: o.status,
      provider: o.provider,
      providerOrderId: o.providerOrderId,
      at: o.createdAt,
    };
  }

  async create(userId: string, serviceId: string, quantity: number, link: string) {
    const svc = this.services.find(serviceId);
    if (!svc) throw new NotFoundException('Service not found');
    const qty = Math.max(svc.min || 1, quantity || 0);
    if (svc.max && qty > svc.max) throw new BadRequestException(`Max quantity is ${svc.max}`);
    const charge = Number(((svc.price * qty) / 1000).toFixed(4));

    const order = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      if (Number(user.balance) < charge) {
        throw new BadRequestException('Insufficient balance');
      }
      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: charge }, spent: { increment: charge } },
      });
      await tx.transaction.create({
        data: { userId, type: 'OrderCharge', amount: charge, method: 'Wallet', note: svc.name },
      });
      return tx.order.create({
        data: {
          userId,
          serviceId: svc.id,
          serviceName: svc.name,
          platform: svc.platform,
          link: link || '(none)',
          quantity: qty,
          charge,
          providerCostInr: Number(((svc.providerCostInr || 0) * qty / 1000).toFixed(4)),
          status: 'Queued',
          provider: svc.provider || 'auto',
          providerServiceId: svc.providerServiceId,
          providerCurrency: svc.providerCurrency,
        },
      });
    });

    try {
      const fulfillment = await this.services.fulfill(svc, qty, link);
      const routed = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'Processing',
          provider: fulfillment.provider,
          providerServiceId: fulfillment.providerServiceId,
          providerOrderId: fulfillment.providerOrderId,
          providerCurrency: fulfillment.providerCurrency,
        },
      });
      // Send order email fire-and-forget
      void this.prisma.user.findUnique({ where: { id: userId } }).then((u) => {
        if (u) void this.email.sendOrderPlaced(u.email, u.name, order.id, svc.name, qty, charge, fulfillment.provider);
      });
      return this.shape(routed);
    } catch (err) {
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: 'Failed' } });
        await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: charge }, spent: { decrement: charge } },
        });
        await tx.transaction.create({
          data: {
            userId,
            type: 'Refund',
            amount: charge,
            method: 'Wallet',
            note: `Provider failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          },
        });
      });
      throw new BadRequestException(`Provider order failed: ${err instanceof Error ? err.message : 'try again later'}`);
    }
  }

  async list(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return orders.map((o) => this.shape(o));
  }

  async refill(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.providerOrderId || !order.provider) {
      return { ok: true, orderId, message: 'Refill queued' };
    }
    const providerKey = order.provider.toLowerCase().replace('smm', '').trim();
    const keyMap: Record<string, string> = { easy: 'easy', luv: 'luv', fine: 'fine', easysmm: 'easy', luvsmm: 'luv', finesmm: 'fine' };
    try {
      await this.services.refillOrder(keyMap[providerKey] || providerKey, order.providerOrderId);
    } catch {
      /* refill best-effort — don't fail if provider rejects */
    }
    return { ok: true, orderId, message: 'Refill requested' };
  }

  async cancel(userId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id: orderId, userId } });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === 'Completed' || order.status === 'Canceled') {
        throw new BadRequestException('Order cannot be canceled');
      }
      const refund = Number(order.charge);
      await tx.order.update({ where: { id: orderId }, data: { status: 'Canceled' } });
      await tx.user.update({ where: { id: userId }, data: { balance: { increment: refund } } });
      await tx.transaction.create({
        data: { userId, type: 'Refund', amount: refund, method: 'Wallet', note: `Cancel ${order.id}` },
      });
      return { ok: true, orderId, refunded: refund };
    });
  }
}
