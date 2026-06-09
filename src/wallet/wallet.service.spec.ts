import { Prisma } from '@prisma/client';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Protects the payment-replay fix: crediting the wallet twice with the same
 * Razorpay payment id (Transaction.ref) must NOT double the balance.
 * If this test goes red, the "verify the same payment N times = free money"
 * hole has reopened.
 */
describe('WalletService.credit idempotency', () => {
  function makeService(prisma: Partial<PrismaService>) {
    return new WalletService(prisma as PrismaService);
  }

  it('credits once on a fresh ref', async () => {
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: { update: jest.fn() },
          transaction: { create: jest.fn() },
        }),
      ),
      user: { findUnique: jest.fn().mockResolvedValue({ balance: 500 }) },
    };
    const wallet = makeService(prisma as unknown as PrismaService);

    const res = await wallet.credit('user-1', 500, 'Razorpay', 'pay_ABC', 'pay_ABC');

    expect(res.duplicate).toBe(false);
    expect(res.added).toBe(500);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does NOT credit again when the ref already exists (P2002)', async () => {
    const dupErr = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(dupErr),
      user: { findUnique: jest.fn().mockResolvedValue({ balance: 500 }) },
    };
    const wallet = makeService(prisma as unknown as PrismaService);

    const res = await wallet.credit('user-1', 500, 'Razorpay', 'pay_ABC', 'pay_ABC');

    expect(res.duplicate).toBe(true);
    expect(res.added).toBe(0);
    // balance reflects the FIRST credit only, not a second one
    expect(res.balance).toBe(500);
  });

  it('rejects non-positive amounts', async () => {
    const wallet = makeService({} as PrismaService);
    await expect(wallet.credit('user-1', 0, 'Razorpay')).rejects.toThrow();
  });
});
