import { Controller, Get, Query } from '@nestjs/common';
import { ServicesService } from './services.service';

@Controller('services')
export class ServicesController {
  constructor(private services: ServicesService) {}

  // Public — powers the marketplace. Optional ?platform= & ?q= filters.
  // Returns customer-safe services only (no provider name, cost, or margin).
  @Get()
  list(@Query('platform') platform?: string, @Query('q') q?: string) {
    let list = this.services.publicAll();
    if (platform && platform !== 'All') {
      list = list.filter((s) => s.platform === platform);
    }
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((s) =>
        (s.name + ' ' + s.platform + ' ' + s.category).toLowerCase().includes(needle),
      );
    }
    return { count: list.length, services: list };
  }

  @Get('provider-status')
  providerStatus() {
    // Public endpoint — only expose live flag + total count, never provider names.
    return this.services.publicStatus();
  }
}
