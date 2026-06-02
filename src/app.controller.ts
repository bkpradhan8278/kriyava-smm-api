import { Controller, Get } from '@nestjs/common';
import { ServicesService } from './services/services.service';

@Controller()
export class AppController {
  constructor(private services: ServicesService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'kriyava-api',
      services: this.services.count(),
      time: new Date().toISOString(),
    };
  }
}
