import { Controller, Get, Post, Body, NotFoundException, BadRequestException, UseGuards } from '@nestjs/common';
import { ServicesService } from './services/services.service';
import { PrismaService } from './prisma/prisma.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AdminGuard } from './auth/admin.guard';
import { CurrentUser } from './auth/current-user.decorator';
import type { AuthUser } from './auth/current-user.decorator';

@Controller()
export class AppController {
  constructor(
    private services: ServicesService,
    private prisma: PrismaService,
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

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/summary')
  async adminSummary(@CurrentUser() _user: AuthUser) {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const istShift = 5.5 * 60 * 60 * 1000;
    const start = new Date(todayStart.getTime() - istShift);

    const [totalUsers, allOrders, todayOrders, allDeposits, todayDeposits, users] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.order.findMany({ where: { createdAt: { gte: start } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.transaction.findMany({ where: { type: 'Deposit' }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.transaction.findMany({ where: { type: 'Deposit', createdAt: { gte: start } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, name: true, email: true, balance: true, spent: true, apiKey: true, role: true, createdAt: true } }),
    ]);

    const margin = 0.15;
    const enrichOrders = (orders: typeof allOrders) =>
      orders.map((o) => {
        const charge = Number(o.charge);
        const providerCost = +(charge / (1 + margin)).toFixed(4);
        return {
          id: o.id,
          service: o.serviceName,
          platform: o.platform,
          qty: o.quantity,
          charge,
          providerCost,
          profit: +(charge - providerCost).toFixed(4),
          provider: o.provider,
          status: o.status,
          time: new Date(o.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        };
      });

    const calcTotals = (orders: ReturnType<typeof enrichOrders>) => {
      const active = orders.filter((o) => o.status !== 'Failed' && o.status !== 'Canceled');
      return {
        count: orders.length,
        activeCount: active.length,
        failedCount: orders.filter((o) => o.status === 'Failed').length,
        revenue: +active.reduce((s, o) => s + o.charge, 0).toFixed(2),
        providerCost: +active.reduce((s, o) => s + o.providerCost, 0).toFixed(2),
        profit: +active.reduce((s, o) => s + o.profit, 0).toFixed(2),
      };
    };

    const enrichedAll = enrichOrders(allOrders);
    const enrichedToday = enrichOrders(todayOrders);

    return {
      asOf: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      totalUsers,
      providerStatus: this.services.providerStats(),
      today: { ...calcTotals(enrichedToday), orders: enrichedToday },
      allTime: calcTotals(enrichedAll),
      recentOrders: enrichedAll.slice(0, 50),
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        balance: Number(u.balance),
        spent: Number(u.spent),
        role: u.role,
        joined: new Date(u.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      })),
      deposits: allDeposits.map((d) => ({
        amount: Number(d.amount),
        method: d.method,
        note: d.note,
        time: new Date(d.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      })),
      todayDeposits: todayDeposits.reduce((s, d) => s + Number(d.amount), 0),
    };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/add-funds')
  async adminAddFunds(@Body() body: { email?: string; amount?: number; note?: string }) {
    if (!body.email) throw new BadRequestException('email required');
    const amt = Number(body.amount);
    if (!amt || amt <= 0 || amt > 100000) throw new BadRequestException('Invalid amount (1–100000)');
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw new NotFoundException(`User ${body.email} not found`);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { balance: { increment: amt } } }),
      this.prisma.transaction.create({ data: { userId: user.id, type: 'Deposit', amount: amt, method: 'Manual', note: body.note || 'Admin credit' } }),
    ]);
    const updated = await this.prisma.user.findUnique({ where: { id: user.id } });
    return { ok: true, email: body.email, added: amt, newBalance: Number(updated?.balance ?? 0) };
  }
}
