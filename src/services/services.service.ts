import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
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
  description?: string;
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
  dripfeed?: boolean;
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

  private disabledProviders = new Set<string>(); // provider keys: 'easy', 'luv', 'fine'
  private disabledServices = new Set<string>();   // service IDs
  private markupOverrides = new Map<string, number>(); // 'global' | platform name -> %

  constructor(private config: ConfigService, private prisma: PrismaService) {
    this.load();
  }

  onModuleInit() {
    void this.loadAdminConfig().then(() => this.refreshProviders());
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

  private descriptionFor(name: string, speed: string, refill: string, quality: number, min: number | null, max: number | null, country: string, canCancel: boolean): string {
    const parts: string[] = [];
    const n = name.toLowerCase();

    // What is this service
    const type =
      n.includes('follower') ? 'followers' :
      n.includes('like') ? 'likes' :
      n.includes('view') || n.includes('watch') ? 'views' :
      n.includes('comment') ? 'comments' :
      n.includes('subscriber') || n.includes('sub') ? 'subscribers' :
      n.includes('member') ? 'members' :
      n.includes('story') ? 'story views' :
      n.includes('reel') ? 'reel views' :
      n.includes('share') ? 'shares' :
      n.includes('save') ? 'saves' :
      'engagement';

    // Speed
    const speedTag = speed === 'Instant' ? 'starts instantly' :
                     speed === 'Super fast' ? 'super fast delivery' :
                     speed === 'Fast' ? 'fast delivery' : 'gradual delivery';

    parts.push(`Delivers ${type} at ${speedTag}.`);

    // Country / quality
    if (country === 'India') parts.push('Indian profiles.');
    else if (n.includes('worldwide') || n.includes('global')) parts.push('Worldwide accounts.');

    // Quality signals
    if (n.includes('real') || n.includes('genuine') || n.includes('organic')) parts.push('Real & active accounts.');
    else if (n.includes('bot') || n.includes('cheap')) parts.push('Low-cost, non-drop not guaranteed.');
    else if (n.includes('non-drop') || n.includes('non drop')) parts.push('Non-drop guaranteed.');
    else if (quality >= 4) parts.push('High quality profiles.');

    // Refill
    if (refill === 'Refill available') parts.push('Includes refill guarantee.');
    else parts.push('No refill included.');

    // Min/max
    if (min) parts.push(`Min order: ${min.toLocaleString()}.`);
    if (canCancel) parts.push('Cancel button available.');

    return parts.join(' ');
  }

  /**
   * Tiered markup by service type and price:
   *
   * Views / Likes / Story / Share / Comments / Reels  → 22% flat (cheap, high-volume)
   * Followers / Subscribers / Members (tiered by costInr per 1000):
   *   ≥ ₹100  → 15%   (premium services, smaller margin)
   *   ≥ ₹70   → 20%
   *   < ₹70   → 25%   (cheap followers, higher margin)
   * All other services                                → 20%
   */
  private markupPct(name: string, category: string, costInr: number, platform?: string): number {
    if (this.markupOverrides.has('global')) return this.markupOverrides.get('global')!;
    if (platform && this.markupOverrides.has(platform)) return this.markupOverrides.get(platform)!;
    const text = `${name} ${category}`.toLowerCase();
    if (/\b(view|like|story|stories|share|comment|reel|impression|reach|save)\b/.test(text)) return 22;
    if (/\b(follower|subscriber|sub\b|member|fan)\b/.test(text)) {
      if (costInr >= 100) return 15;
      if (costInr >= 70) return 20;
      return 25;
    }
    return 20;
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

  private providerKey(name: string): string {
    return name.toLowerCase().replace('smm', '').trim();
  }

  private async loadAdminConfig() {
    try {
      const rows = await this.prisma.config.findMany();
      for (const row of rows) {
        try {
          const val = JSON.parse(row.value) as unknown;
          if (row.key === 'disabled_providers') this.disabledProviders = new Set(val as string[]);
          else if (row.key === 'disabled_services') this.disabledServices = new Set(val as string[]);
          else if (row.key === 'markup_overrides') this.markupOverrides = new Map(Object.entries(val as Record<string, number>));
        } catch { /* bad row, skip */ }
      }
    } catch { /* DB not ready, skip */ }
  }

  private async saveConfig(key: string, value: unknown) {
    const v = JSON.stringify(value);
    await this.prisma.config.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
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
      const svcCategory = primary.service.category || primary.service.type || 'General';
      const svcPlatform = this.platformFor(`${svcCategory} ${primary.service.name}`);
      const markup = this.markupPct(primary.service.name, svcCategory, primary.option.costInr, svcPlatform);
      const speed = this.speedFor(primary.service.name);
      const refill = primary.option.refill ? 'Refill available' : 'No refill';
      const quality = this.qualityFor(`${svcCategory} ${primary.service.name}`);
      const country = this.countryFor(`${svcCategory} ${primary.service.name}`);
      const safeMin = Number.isFinite(min) ? min : 1;
      const safeMax = Number.isFinite(max) && max > 0 ? max : null;
      liveServices.push({
        id: `${primary.option.key}:${primary.option.serviceId}`,
        name: primary.service.name,
        platform: svcPlatform,
        category: svcCategory,
        country,
        price: Number((primary.option.costInr * (1 + markup / 100)).toFixed(4)),
        margin_pct: markup,
        speed,
        refill,
        quality,
        min: safeMin,
        max: safeMax,
        provider: primary.option.name,
        description: this.descriptionFor(primary.service.name, speed, refill, quality, safeMin, safeMax, country, Boolean(primary.option.cancel)),
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
    return this.services.filter(s =>
      !this.disabledServices.has(s.id) &&
      !this.disabledProviders.has(this.providerKey(s.provider || ''))
    );
  }

  find(id: string): MarketService | undefined {
    const svc = this.byId.get(id);
    if (!svc) return undefined;
    if (this.disabledServices.has(id)) return undefined;
    if (this.disabledProviders.has(this.providerKey(svc.provider || ''))) return undefined;
    return svc;
  }

  count() {
    return this.services.length;
  }

  adminCatalog() {
    return this.services.map(s => ({
      id: s.id,
      name: s.name,
      platform: s.platform,
      category: s.category,
      provider: s.provider,
      providerKey: this.providerKey(s.provider || ''),
      providerCostInr: s.providerCostInr || 0,
      margin_pct: s.margin_pct,
      price: s.price,
      min: s.min,
      max: s.max,
      enabled: !this.disabledServices.has(s.id) && !this.disabledProviders.has(this.providerKey(s.provider || '')),
    }));
  }

  providerAdminStats() {
    const counts: Record<string, number> = {};
    for (const p of this.providers) counts[p.name] = (counts[p.name] || 0) + 1;
    const balances: Record<string, string> = {};
    for (const [key, info] of this.providerBalances) {
      const cfg = this.providerConfigs().find(p => p.key === key);
      if (cfg) balances[cfg.name] = `${info.balance.toFixed(2)} ${info.currency}`;
    }
    const configs = this.providerConfigs();
    const providers = configs.map(cfg => ({
      key: cfg.key,
      name: cfg.name,
      apiKeyMasked: cfg.apiKey ? `${cfg.apiKey.slice(0, 8)}${'•'.repeat(Math.max(0, (cfg.apiKey.length) - 8))}` : 'NOT SET',
      enabled: !this.disabledProviders.has(cfg.key),
      balance: balances[cfg.name] || '0.00 ?',
      serviceCount: counts[cfg.name] || 0,
    }));
    return {
      live: this.providers.length > 0,
      totalServices: this.services.length,
      providers,
      markupOverrides: Object.fromEntries(this.markupOverrides),
      platforms: [...new Set(this.services.map(s => s.platform))].sort(),
    };
  }

  async setProviderEnabled(key: string, enabled: boolean) {
    if (enabled) this.disabledProviders.delete(key);
    else this.disabledProviders.add(key);
    await this.saveConfig('disabled_providers', [...this.disabledProviders]);
  }

  async setServiceEnabled(serviceId: string, enabled: boolean) {
    if (enabled) this.disabledServices.delete(serviceId);
    else this.disabledServices.add(serviceId);
    await this.saveConfig('disabled_services', [...this.disabledServices]);
  }

  async setMarkupOverride(target: string, value: number | null) {
    if (value === null || value === undefined) this.markupOverrides.delete(target);
    else this.markupOverrides.set(target, Math.max(1, Math.min(200, value)));
    await this.saveConfig('markup_overrides', Object.fromEntries(this.markupOverrides));
    void this.refreshProviders();
  }
}
