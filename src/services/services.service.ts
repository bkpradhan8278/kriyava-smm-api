import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export interface MarketService {
  id: string;
  name: string;
  platform: string;
  category: string;
  country: string;
  price: number;
  margin_pct: number;
  speed: string;
  refill: string;
  quality: number;
  min: number | null;
  max: number | null;
  provider: string;
  providerServiceId?: string;
  providerCostInr?: number;
  providerRate?: number;
  providerCurrency?: string;
  backupProviders?: ProviderOption[];
}

export interface ProviderOption {
  key: string;
  name: string;
  apiUrl: string;
  serviceId: string;
  rate: number;
  currency: string;
  costInr: number;
  refill: boolean;
  cancel: boolean;
}

interface ProviderApiService {
  service: number | string;
  name: string;
  type?: string;
  category?: string;
  rate: string;
  min?: number | string;
  max?: number | string;
  refill?: boolean;
  cancel?: boolean;
}

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class ServicesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServicesService.name);
  private services: MarketService[] = [];
  private staticServices: MarketService[] = [];
  private byId = new Map<string, MarketService>();
  private providers: ProviderOption[] = [];
  private providerByServiceId = new Map<string, ProviderOption>();
  private providerBalances = new Map<string, { balance: number; currency: string }>();
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(private config: ConfigService) {
    this.load();
  }

  onModuleInit() {
    void this.refreshProviders();
    this.refreshTimer = setInterval(() => void this.refreshProviders(), REFRESH_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private load() {
    // data file is copied next to compiled output via nest-cli assets, and also exists in src
    const candidates = [
      path.join(__dirname, 'data', 'services_market.json'),
      path.join(__dirname, 'data', 'services', 'data', 'services_market.json'),
      path.join(process.cwd(), 'dist', 'services', 'data', 'services_market.json'),
      path.join(process.cwd(), 'src', 'services', 'data', 'services_market.json'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
          this.staticServices = raw.services || [];
          this.services = this.staticServices;
          break;
        }
      } catch {
        /* try next */
      }
    }
    this.reindex();
  }

  private reindex() {
    this.byId.clear();
    this.providerByServiceId.clear();
    for (const s of this.services) this.byId.set(s.id, s);
    for (const p of this.providers) this.providerByServiceId.set(`${p.key}:${p.serviceId}`, p);
  }

  private providerConfigs() {
    return [
      {
        key: 'easy',
        name: 'EasySMM',
        apiUrl: 'https://easysmmpanel.com/api/v2',
        apiKey: this.config.get<string>('EASY_SMM_API_KEY'),
      },
      {
        key: 'luv',
        name: 'LuvSMM',
        apiUrl: 'https://luvsmm.com/api/v2',
        apiKey: this.config.get<string>('LUV_SMM_API_KEY'),
      },
      {
        key: 'fine',
        name: 'FineSMM',
        apiUrl: 'https://finesmmpanel.com/api/v2',
        apiKey: this.config.get<string>('FINE_SMM_API_KEY'),
      },
    ].filter((p) => Boolean(p.apiKey));
  }

  private async providerPost<T>(apiUrl: string, apiKey: string, body: Record<string, string | number>) {
    const params = new URLSearchParams({ key: apiKey, ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])) });
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = (await res.json()) as T;
    if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
    return data;
  }

  private async fetchProviderInfo(apiUrl: string, apiKey: string): Promise<{ currency: string; balance: number }> {
    const data = await this.providerPost<{ balance?: string; currency?: string }>(apiUrl, apiKey, { action: 'balance' });
    return {
      currency: (data.currency || 'INR').toUpperCase(),
      balance: Number(data.balance || 0),
    };
  }

  private costInr(rate: number, currency: string) {
    const usdInr = Number(this.config.get<string>('USD_INR_RATE') || 84);
    return currency === 'USD' ? rate * usdInr : rate;
  }

  private platformFor(text: string) {
    const q = text.toLowerCase();
    if (q.includes('instagram')) return 'Instagram';
    if (q.includes('youtube')) return 'YouTube';
    if (q.includes('telegram')) return 'Telegram';
    if (q.includes('tiktok')) return 'TikTok';
    if (q.includes('facebook')) return 'Facebook';
    if (q.includes('spotify')) return 'Spotify';
    if (q.includes('twitter') || q.includes(' x ')) return 'X';
    if (q.includes('website')) return 'Website';
    return 'Other';
  }

  private countryFor(text: string) {
    const q = text.toLowerCase();
    if (q.includes('india') || q.includes('indian')) return 'India';
    if (q.includes('usa') || q.includes('united states')) return 'USA';
    if (q.includes('worldwide') || q.includes('global')) return 'Global';
    return 'Global';
  }

  private qualityFor(text: string) {
    const q = text.toLowerCase();
    if (q.includes('hq') || q.includes('high quality') || q.includes('real') || q.includes('non-drop')) return 5;
    if (q.includes('medium') || q.includes('refill')) return 4;
    if (q.includes('cheap') || q.includes('bot') || q.includes('drop')) return 2;
    return 3;
  }

  private speedFor(text: string) {
    const q = text.toLowerCase();
    if (q.includes('instant')) return 'Instant';
    if (q.includes('super fast') || q.includes('fastest')) return 'Super fast';
    if (q.includes('fast')) return 'Fast';
    if (q.includes('slow')) return 'Slow';
    return 'Provider avg';
  }

  private matchKey(s: ProviderApiService) {
    const text = `${s.category || ''} ${s.name}`.toLowerCase();
    return text
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\b(speed|quality|refill|button|available|max|min|day|days|hours|instant|fast|slow|super|provider)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
  }

  async refreshProviders() {
    const configs = this.providerConfigs();
    if (configs.length === 0) return;
    const fetched: Array<{ service: ProviderApiService; option: ProviderOption; matchKey: string }> = [];
    for (const cfg of configs) {
      try {
        const { currency, balance } = await this.fetchProviderInfo(cfg.apiUrl, cfg.apiKey!);
        this.providerBalances.set(cfg.key, { balance, currency });
        this.logger.log(`${cfg.name} balance: ${balance} ${currency}`);
        const services = await this.providerPost<ProviderApiService[]>(cfg.apiUrl, cfg.apiKey!, { action: 'services' });
        for (const service of Array.isArray(services) ? services : []) {
          const rate = Number(service.rate);
          if (!Number.isFinite(rate) || rate < 0) continue;
          const serviceId = String(service.service);
          const costInr = this.costInr(rate, currency);
          fetched.push({
            service,
            matchKey: this.matchKey(service),
            option: {
              key: cfg.key,
              name: cfg.name,
              apiUrl: cfg.apiUrl,
              serviceId,
              rate,
              currency,
              costInr,
              refill: Boolean(service.refill),
              cancel: Boolean(service.cancel),
            },
          });
        }
      } catch (err) {
        this.logger.warn(`${cfg.name} service sync failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }

    if (fetched.length === 0) return;
    const groups = new Map<string, typeof fetched>();
    for (const row of fetched) {
      const key = row.matchKey || `${row.option.key}:${row.option.serviceId}`;
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    }

    this.providers = fetched.map((r) => r.option);
    const liveServices: MarketService[] = [];
    for (const [, rows] of groups) {
      rows.sort((a, b) => a.option.costInr - b.option.costInr);
      const primary = rows[0];
      const backups = rows.slice(1, 3).map((r) => r.option);
      const min = Number(primary.service.min || 1);
      const max = Number(primary.service.max || 0);
      liveServices.push({
        id: `${primary.option.key}:${primary.option.serviceId}`,
        name: primary.service.name,
        platform: this.platformFor(`${primary.service.category || ''} ${primary.service.name}`),
        category: primary.service.category || primary.service.type || 'General',
        country: this.countryFor(`${primary.service.category || ''} ${primary.service.name}`),
        price: Number((primary.option.costInr * 1.15).toFixed(4)),
        margin_pct: 15,
        speed: this.speedFor(primary.service.name),
        refill: primary.option.refill ? 'Refill available' : 'No refill',
        quality: this.qualityFor(`${primary.service.category || ''} ${primary.service.name}`),
        min: Number.isFinite(min) ? min : 1,
        max: Number.isFinite(max) && max > 0 ? max : null,
        provider: primary.option.name,
        providerServiceId: primary.option.serviceId,
        providerCostInr: Number(primary.option.costInr.toFixed(4)),
        providerRate: primary.option.rate,
        providerCurrency: primary.option.currency,
        backupProviders: backups,
      });
    }
    liveServices.sort((a, b) => a.platform.localeCompare(b.platform) || a.price - b.price);
    this.services = liveServices;
    this.reindex();
    this.logger.log(`Provider catalog synced: ${this.services.length} best-priced services from ${this.providers.length} provider endpoints`);
  }

  providerStats() {
    const counts: Record<string, number> = {};
    for (const p of this.providers) counts[p.name] = (counts[p.name] || 0) + 1;
    const balances: Record<string, string> = {};
    for (const [key, info] of this.providerBalances) {
      const cfg = this.providerConfigs().find((p) => p.key === key);
      if (cfg) balances[cfg.name] = `${info.balance.toFixed(2)} ${info.currency}`;
    }
    return { live: this.providers.length > 0, services: this.services.length, providers: counts, balances };
  }

  async fulfill(service: MarketService, quantity: number, link: string) {
    const candidates = [
      this.providerByServiceId.get(service.id),
      ...(service.backupProviders || []),
    ].filter(Boolean) as ProviderOption[];
    let lastError = 'No provider route configured';
    for (const provider of candidates) {
      const cfg = this.providerConfigs().find((p) => p.key === provider.key);
      if (!cfg?.apiKey) continue;

      // Skip provider if our balance there is too low for this order
      const acctBal = this.providerBalances.get(provider.key);
      if (acctBal) {
        const orderCost = (provider.rate * quantity) / 1000;
        if (acctBal.balance < orderCost) {
          lastError = `${provider.name} skipped: balance ${acctBal.balance.toFixed(3)} ${acctBal.currency} < needed ${orderCost.toFixed(3)}`;
          this.logger.warn(`Routing: ${lastError} — trying next provider`);
          continue;
        }
      }

      try {
        const res = await this.providerPost<{ order?: string | number; error?: string }>(provider.apiUrl, cfg.apiKey, {
          action: 'add',
          service: provider.serviceId,
          link,
          quantity,
        });
        if (res.order) {
          this.logger.log(`Order placed via ${provider.name} (svc ${provider.serviceId}) qty=${quantity}`);
          // Deduct from cached balance so subsequent orders in the same refresh window route correctly
          if (acctBal) acctBal.balance -= (provider.rate * quantity) / 1000;
          return {
            provider: provider.name,
            providerServiceId: provider.serviceId,
            providerOrderId: String(res.order),
            providerCurrency: provider.currency,
          };
        }
        lastError = res.error || `${provider.name} rejected order`;
        this.logger.warn(`${provider.name} rejected: ${lastError}`);
      } catch (err) {
        lastError = err instanceof Error ? err.message : `${provider.name} failed`;
        this.logger.warn(`${provider.name} error: ${lastError}`);
      }
    }
    throw new Error(lastError);
  }

  async refillOrder(providerKey: string, providerOrderId: string) {
    const cfg = this.providerConfigs().find((p) => p.key === providerKey);
    if (!cfg?.apiKey) throw new Error('Provider not configured');
    const res = await this.providerPost<{ refill?: string | number; error?: string }>(cfg.apiUrl, cfg.apiKey, {
      action: 'refill',
      order: providerOrderId,
    });
    if (res.error) throw new Error(res.error);
    return { refillId: res.refill ? String(res.refill) : null };
  }

  all() {
    return this.services;
  }

  find(id: string): MarketService | undefined {
    return this.byId.get(id);
  }

  count() {
    return this.services.length;
  }
}
