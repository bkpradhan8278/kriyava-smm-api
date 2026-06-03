import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServicesService } from './services/services.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private services: ServicesService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'kriyava-api',
      services: this.services.count(),
      time: new Date().toISOString(),
    };
  }

  // Admin summary — secured by JWT_SECRET header. Returns today's orders + profit.
  @Get('admin/summary')
  async adminSummary(@Headers('x-admin-key') key: string) {
    if (key !== this.config.get<string>('JWT_SECRET')) throw new UnauthorizedException();

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    // shift for IST (+5:30)
    const istStart = new Date(todayStart.getTime() - 5.5 * 60 * 60 * 1000);

    const [users, allOrders, todayOrders, todayTxns, providerStats] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.order.findMany({ where: { createdAt: { gte: istStart } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.transaction.findMany({ where: { createdAt: { gte: istStart } }, orderBy: { createdAt: 'desc' } }),
      this.services.providerStats(),
    ]);

    const margin = 0.15;
    const summarize = (orders: typeof allOrders) =>
      orders.map((o) => {
        const charge = Number(o.charge);
        const providerCost = +(charge / (1 + margin)).toFixed(4);
        const profit = +(charge - providerCost).toFixed(4);
        return {
          id: o.id,
          service: o.serviceName,
          platform: o.platform,
          qty: o.quantity,
          chargedToWallet: charge,
          providerCost,
          profit,
          marginPct: '15%',
          provider: o.provider,
          status: o.status,
          time: new Date(o.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        };
      });

    const totals = (orders: ReturnType<typeof summarize>) => ({
      orders: orders.length,
      totalCharged: +orders.reduce((s, o) => s + o.chargedToWallet, 0).toFixed(2),
      totalProviderCost: +orders.reduce((s, o) => s + o.providerCost, 0).toFixed(2),
      totalProfit: +orders.reduce((s, o) => s + o.profit, 0).toFixed(2),
    });

    const todaySummary = summarize(todayOrders);
    const allSummary = summarize(allOrders);

    return {
      asOf: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      totalUsers: users,
      providerStatus: providerStats,
      today: { ...totals(todaySummary), orders: todaySummary },
      allTime: totals(allSummary),
      todayDeposits: todayTxns.filter((t) => t.type === 'Deposit').map((t) => ({
        amount: Number(t.amount),
        method: t.method,
        time: new Date(t.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      })),
    };
  }
}
