import { Controller, Get, Post, Body, NotFoundException, BadRequestException, UseGuards, HttpCode } from '@nestjs/common';
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

    const enrichOrders = (orders: typeof allOrders) =>
      orders.map((o) => {
        const charge = Number(o.charge);
        const providerCost = Number(o.providerCostInr) || 0;
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
  @Post('admin/providers/refresh')
  @HttpCode(200)
  async adminRefreshProviders() {
    await this.services.refreshProviders();
    return { ok: true, providerStatus: this.services.providerStats() };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/service-catalog')
  async adminServiceCatalog() {
    return this.services.providerAdminStats();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/catalog')
  async adminFullCatalog() {
    return { services: this.services.adminCatalog() };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/providers/toggle')
  @HttpCode(200)
  async adminProviderToggle(@Body() body: { key?: string; enabled?: boolean }) {
    if (!body.key) throw new BadRequestException('key required');
    if (typeof body.enabled !== 'boolean') throw new BadRequestException('enabled (boolean) required');
    await this.services.setProviderEnabled(body.key, body.enabled);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/services/toggle')
  @HttpCode(200)
  async adminServiceToggle(@Body() body: { serviceId?: string; enabled?: boolean }) {
    if (!body.serviceId) throw new BadRequestException('serviceId required');
    if (typeof body.enabled !== 'boolean') throw new BadRequestException('enabled (boolean) required');
    await this.services.setServiceEnabled(body.serviceId, body.enabled);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/services/markup')
  @HttpCode(200)
  async adminMarkupOverride(@Body() body: { target?: string; value?: number | null }) {
    if (!body.target) throw new BadRequestException('target required');
    await this.services.setMarkupOverride(body.target, body.value ?? null);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/referrals')
  async adminReferrals(@CurrentUser() _user: AuthUser) {
    const users = await this.prisma.user.findMany({
      orderBy: { referralEarned: 'desc' },
      select: { id: true, name: true, email: true, referralCode: true, referralEarned: true, referredBy: true, createdAt: true },
    });
    const referralTxns = await this.prisma.transaction.findMany({ where: { type: 'Referral' }, orderBy: { createdAt: 'desc' }, take: 100 });
    const referrers = users.filter((u) => Number(u.referralEarned) > 0);
    const referred = users.filter((u) => u.referredBy);
    const totalPaid = referralTxns.reduce((s, t) => s + Number(t.amount), 0);

    return {
      summary: { totalReferrers: referrers.length, totalReferred: referred.length, totalPaidOut: +totalPaid.toFixed(2) },
      topReferrers: referrers.slice(0, 20).map((u) => ({
        name: u.name, email: u.email, referralCode: u.referralCode,
        earned: Number(u.referralEarned),
        referredCount: users.filter((x) => x.referredBy === u.id).length,
      })),
      recentActivity: referralTxns.slice(0, 30).map((t) => ({
        amount: Number(t.amount), note: t.note, time: new Date(t.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      })),
    };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/leads')
  async adminLeads() {
    const [leads, tickets, ticketUsers] = await Promise.all([
      this.prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
      this.prisma.ticket.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.user.findMany({ select: { id: true, name: true, email: true } }),
    ]);
    const userMap = new Map(ticketUsers.map((u) => [u.id, u]));

    type LeadRow = {
      id: string; kind: 'lead' | 'ticket'; source: string;
      name: string | null; email: string | null; subject: string | null;
      message: string; reply: string | null; status: string; time: string;
    };

    const rows: LeadRow[] = [];
    for (const l of leads) {
      let reply: string | null = null;
      try { if (l.meta) reply = (JSON.parse(l.meta) as { reply?: string }).reply || null; } catch { /* ignore */ }
      rows.push({
        id: l.id, kind: 'lead', source: l.source,
        name: l.name, email: l.email, subject: l.subject,
        message: l.message, reply, status: l.status,
        time: new Date(l.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      });
    }
    for (const t of tickets) {
      const u = userMap.get(t.userId);
      rows.push({
        id: t.id, kind: 'ticket', source: 'ticket',
        name: u?.name || null, email: u?.email || null, subject: t.subject,
        message: t.message, reply: null, status: t.status,
        time: new Date(t.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      });
    }
    rows.sort((a, b) => (a.time < b.time ? 1 : -1));

    const counts = {
      total: rows.length,
      contact: rows.filter((r) => r.source === 'contact').length,
      ai_chat: rows.filter((r) => r.source === 'ai_chat').length,
      ticket: rows.filter((r) => r.source === 'ticket').length,
      unresolved: rows.filter((r) => r.status === 'New' || r.status === 'Open').length,
    };
    return { counts, leads: rows };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/leads/status')
  @HttpCode(200)
  async adminLeadStatus(@Body() body: { id?: string; kind?: string; status?: string }) {
    if (!body.id || !body.status) throw new BadRequestException('id and status required');
    if (body.kind === 'ticket') {
      await this.prisma.ticket.update({ where: { id: body.id }, data: { status: body.status } });
    } else {
      await this.prisma.lead.update({ where: { id: body.id }, data: { status: body.status } });
    }
    return { ok: true };
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
