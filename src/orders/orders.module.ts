import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderSyncService } from './order-sync.service';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [ServicesModule],
  providers: [OrdersService, OrderSyncService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
