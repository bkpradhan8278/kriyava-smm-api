import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServicesModule } from '../services/services.module';
import { OrdersModule } from '../orders/orders.module';
import { ApiV2Controller } from './apiv2.controller';

@Module({
  imports: [PrismaModule, ServicesModule, OrdersModule],
  controllers: [ApiV2Controller],
})
export class ApiV2Module {}
