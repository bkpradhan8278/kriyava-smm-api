import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  async balance(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (Number(u?.balance ?? 0) === 500 && Number(u?.spent ?? 0) === 0) {
      const [orders, deposits] = await Promise.all([
        this.prisma.order.count({ where: { userId } }),
        this.prisma.transaction.count({ where: { userId, type: 'Deposit' } }),
      ]);
      if (orders === 0 && deposits === 0) {
        const clean = await this.prisma.user.update({ where: { id: userId }, data: { balance: 0 } });
        return { balance: Number(clean.balance), spent: Number(clean.spent) };
      }
    }
    return { balance: Number(u?.balance ?? 0), spent: Number(u?.spent ?? 0) };
  }

  /**
   * Credit the wallet after a verified payment. Called only by the payments
   * module once a Razorpay signature is verified — no free credit, no cashback.
   */
  async credit(userId: string, amount: number, method: string, note?: string) {
    if (!amount || amount <= 0) throw new BadRequestException('Invalid amount');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } },
      });
      await tx.transaction.create({
        data: { userId, type: 'Deposit', amount, method, note },
      });
    });
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    return { added: amount, balance: Number(u?.balance ?? 0) };
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
