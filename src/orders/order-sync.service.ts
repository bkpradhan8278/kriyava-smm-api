import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const BATCH_SIZE = 100; // max provider IDs per request

// Maps provider status strings → our canonical status
function mapStatus(providerStatus: string): string {
  const s = (providerStatus || '').toLowerCase().trim();
  if (s === 'completed') return 'Completed';
  if (s === 'partial') return 'Partial';
  if (s === 'canceled' || s === 'cancelled') return 'Canceled';
  if (s === 'in progress') return 'In progress';
  return 'Processing';
}

interface ProviderStatusResult {
  charge?: string | number;
  start_count?: string | number;
  status?: string;
  remains?: string | number;
  currency?: string;
  error?: string;
}

@Injectable()
export class OrderSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderSyncService.name);
  private timer?: ReturnType<typeof setInterval>;

  private readonly providers: Array<{ key: string; name: string; apiUrl: string; envKey: string }> = [
    { key: 'easy', name: 'EasySMM',  apiUrl: 'https://easysmmpanel.com/api/v2', envKey: 'EASY_SMM_API_KEY' },
    { key: 'luv',  name: 'LuvSMM',   apiUrl: 'https://luvsmm.com/api/v2',       envKey: 'LUV_SMM_API_KEY'  },
    { key: 'fine', name: 'FineSMM',  apiUrl: 'https://finesmmpanel.com/api/v2', envKey: 'FINE_SMM_API_KEY'  },
  ];

  constructor(private prisma: PrismaService, private config: ConfigService) {}

  onModuleInit() {
    // Stagger first sync by 30s to let app fully boot
    setTimeout(() => void this.syncAll(), 30_000);
    this.timer = setInterval(() => void this.syncAll(), SYNC_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async post<T>(apiUrl: string, apiKey: string, params: Record<string, string>) {
    const body = new URLSearchParams({ key: apiKey, ...params });
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    return res.json() as Promise<T>;
  }

  async syncAll() {
    // All orders that are still in-flight and have a providerOrderId
    const pending = await this.prisma.order.findMany({
      where: {
        status: { in: ['Processing', 'In progress', 'Queued'] },
        NOT: { providerOrderId: null },
      },
      select: { id: true, provider: true, providerOrderId: true },
      take: 500,
    });

    if (pending.length === 0) return;
    this.logger.log(`Order sync: checking ${pending.length} in-flight orders`);

    // Group by provider
    const byProvider = new Map<string, typeof pending>();
    for (const o of pending) {
      const key = (o.provider || '').toLowerCase().replace('smm', '').trim();
      const keyMap: Record<string, string> = { easy: 'easy', luv: 'luv', fine: 'fine', easysmm: 'easy', luvsmm: 'luv', finesmm: 'fine' };
      const provKey = keyMap[key] || key;
      const list = byProvider.get(provKey) || [];
      list.push(o);
      byProvider.set(provKey, list);
    }

    let updated = 0;
    for (const [provKey, orders] of byProvider) {
      const provCfg = this.providers.find((p) => p.key === provKey);
      if (!provCfg) continue;
      const apiKey = this.config.get<string>(provCfg.envKey);
      if (!apiKey) continue;

      // Process in batches of BATCH_SIZE
      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        const ids = batch.map((o) => o.providerOrderId!).join(',');
        try {
          const result = await this.post<Record<string, ProviderStatusResult>>(
            provCfg.apiUrl, apiKey,
            { action: 'status', orders: ids },
          );
          for (const o of batch) {
            const r = result[o.providerOrderId!];
            if (!r || r.error || !r.status) continue;
            const newStatus = mapStatus(r.status);
            if (newStatus === 'Processing' || newStatus === 'In progress') continue; // no change needed
            await this.prisma.order.update({
              where: { id: o.id },
              data: { status: newStatus },
            });
            updated++;
          }
        } catch (err) {
          this.logger.warn(`${provCfg.name} status sync failed: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }

    if (updated > 0) this.logger.log(`Order sync: updated ${updated} orders to final status`);
  }
}
