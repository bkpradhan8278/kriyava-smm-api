import { Controller, Post, Get, Body, HttpCode } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from '../services/services.service';
import { OrdersService } from '../orders/orders.service';

// Standard SMM-panel API (v2). Single endpoint, action-based, authenticated by `key`.
// Compatible with the common reseller API format used across the industry.
interface ApiV2Body {
  key?: string;
  action?: string;
  service?: string | number;
  link?: string;
  quantity?: string | number;
  order?: string | number;
  orders?: string;
}

@Controller('v2')
export class ApiV2Controller {
  constructor(
    private prisma: PrismaService,
    private services: ServicesService,
    private orders: OrdersService,
  ) {}

  // Lightweight discovery so GET /api/v2 doesn't 404 for browsers/health checks.
  @Get()
  info() {
    return {
      api: 'Kriyava SMM API v2',
      method: 'POST',
      auth: 'key',
      actions: ['balance', 'services', 'add', 'status', 'refill'],
    };
  }

  @Post()
  @HttpCode(200)
  async handle(@Body() body: ApiV2Body) {
    const key = (body.key || '').trim();
    if (!key) return { error: 'Missing API key' };

    const user = await this.prisma.user.findUnique({ where: { apiKey: key } });
    if (!user) return { error: 'Invalid API key' };

    const action = (body.action || '').trim().toLowerCase();

    switch (action) {
      case 'balance':
        return { balance: Number(user.balance).toFixed(2), currency: 'INR' };

      case 'services':
        return this.services.publicAll().map((s) => ({
          service: s.id,
          name: s.name,
          type: 'Default',
          category: `${s.platform} — ${s.category}`,
          rate: s.price.toFixed(4),
          min: String(s.min ?? 1),
          max: String(s.max ?? 0),
          refill: s.refill === 'Refill available',
          cancel: true,
          dripfeed: false,
        }));

      case 'add': {
        const serviceId = String(body.service || '').trim();
        const link = String(body.link || '').trim();
        const quantity = parseInt(String(body.quantity || '0'), 10);
        if (!serviceId) return { error: 'Missing service' };
        if (!link) return { error: 'Missing link' };
        if (!quantity || quantity < 1) return { error: 'Invalid quantity' };
        try {
          const order = await this.orders.create(user.id, serviceId, quantity, link);
          return { order: order.id };
        } catch (e) {
          return { error: e instanceof Error ? e.message : 'Order failed' };
        }
      }

      case 'status': {
        // Single order, or comma-separated via `orders` → keyed object
        if (body.orders) {
          const ids = String(body.orders).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
          const rows = await this.prisma.order.findMany({ where: { id: { in: ids }, userId: user.id } });
          const out: Record<string, unknown> = {};
          for (const id of ids) {
            const o = rows.find((r) => r.id === id);
            out[id] = o
              ? { charge: Number(o.charge).toFixed(4), start_count: '0', status: o.status, remains: '0', currency: 'INR' }
              : { error: 'Incorrect order ID' };
          }
          return out;
        }
        const id = String(body.order || '').trim();
        if (!id) return { error: 'Missing order' };
        const o = await this.prisma.order.findFirst({ where: { id, userId: user.id } });
        if (!o) return { error: 'Incorrect order ID' };
        return { charge: Number(o.charge).toFixed(4), start_count: '0', status: o.status, remains: '0', currency: 'INR' };
      }

      case 'refill': {
        const id = String(body.order || '').trim();
        if (!id) return { error: 'Missing order' };
        try {
          const res = await this.orders.refill(user.id, id);
          return { refill: res.orderId };
        } catch (e) {
          return { error: e instanceof Error ? e.message : 'Refill failed' };
        }
      }

      default:
        return { error: 'Unknown action' };
    }
  }
}
