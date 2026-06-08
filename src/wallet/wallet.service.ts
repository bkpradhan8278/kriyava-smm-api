import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
   *
   * Idempotent: pass a unique `ref` (e.g. the Razorpay payment id). A replay of
   * the same payment hits the unique constraint on Transaction.ref, the whole
   * transaction rolls back, and we return `duplicate: true` WITHOUT crediting
   * again. This blocks the "verify the same payment N times = free money" attack.
   */
  async credit(userId: string, amount: number, method: string, ref?: string, note?: string) {
    if (!amount || amount <= 0) throw new BadRequestException('Invalid amount');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: amount } },
        });
        await tx.transaction.create({
          data: { userId, type: 'Deposit', amount, method, ref, note },
        });
      });
    } catch (e) {
      // P2002 = unique constraint violation on `ref` → this payment was already credited.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.user.findUnique({ where: { id: userId } });
        return { added: 0, balance: Number(existing?.balance ?? 0), duplicate: true };
      }
      throw e;
    }
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    return { added: amount, balance: Number(u?.balance ?? 0), duplicate: false };
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
