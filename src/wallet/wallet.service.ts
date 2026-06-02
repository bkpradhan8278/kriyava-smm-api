import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  async balance(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    return { balance: Number(u?.balance ?? 0), spent: Number(u?.spent ?? 0) };
  }

  async addFunds(userId: string, amount: number) {
    if (!amount || amount < 50) throw new BadRequestException('Minimum top-up is ₹50');
    const cashback = amount >= 1000 ? Math.round(amount * 0.05) : 0;
    const credit = amount + cashback;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: credit } },
      });
      await tx.transaction.create({
        data: { userId, type: 'Deposit', amount, method: 'Razorpay' },
      });
      if (cashback > 0) {
        await tx.transaction.create({
          data: { userId, type: 'Cashback', amount: cashback, method: 'Bonus', note: '5% deposit cashback' },
        });
      }
    });

    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    return { added: amount, cashback, balance: Number(u?.balance ?? 0) };
  }

  async transactions(userId: string) {
    const txns = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return txns.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      method: t.method,
      note: t.note,
      at: t.createdAt,
    }));
  }
}
