import { Injectable } from '@nestjs/common';
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
}

@Injectable()
export class ServicesService {
  private services: MarketService[] = [];
  private byId = new Map<string, MarketService>();

  constructor() {
    this.load();
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
          this.services = raw.services || [];
          break;
        }
      } catch {
        /* try next */
      }
    }
    for (const s of this.services) this.byId.set(s.id, s);
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
