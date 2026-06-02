import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from '../services/services.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private services: ServicesService,
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
          status: 'Processing',
          provider: svc.provider || 'auto',
        },
      });
    });

    return this.shape(order);
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
    // demo: mark as processing again (a real impl would call the provider refill endpoint)
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
