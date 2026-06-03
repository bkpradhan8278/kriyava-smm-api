import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('referrals')
export class ReferralsController {
  constructor(private prisma: PrismaService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async myReferrals(@CurrentUser() user: AuthUser) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { referralCode: true, referralEarned: true },
    });

    const referredCount = await this.prisma.user.count({ where: { referredBy: user.userId } });

    const recentEarnings = await this.prisma.transaction.findMany({
      where: { userId: user.userId, type: 'Referral' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { amount: true, note: true, createdAt: true },
    });

    return {
      code: me?.referralCode || null,
      link: me?.referralCode ? `https://smm.kriyava.com/login?ref=${me.referralCode}` : null,
      earned: Number(me?.referralEarned ?? 0),
      referredCount,
      commissionPct: 5,
      recentEarnings: recentEarnings.map((e) => ({
        amount: Number(e.amount),
        note: e.note,
        time: new Date(e.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      })),
    };
  }
}
