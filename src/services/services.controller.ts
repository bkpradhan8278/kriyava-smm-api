import { Controller, Get, Query } from '@nestjs/common';
import { ServicesService } from './services.service';

@Controller('services')
export class ServicesController {
  constructor(private services: ServicesService) {}

  // Public — powers the marketplace. Optional ?platform= & ?q= filters.
  @Get()
  list(@Query('platform') platform?: string, @Query('q') q?: string) {
    let list = this.services.all();
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
}
