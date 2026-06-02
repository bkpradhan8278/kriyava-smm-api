import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [ServicesModule],
  providers: [OrdersService],
  controllers: [OrdersController],
})
export class OrdersModule {}
