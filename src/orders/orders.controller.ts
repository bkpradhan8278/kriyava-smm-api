import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';

class CreateOrderDto {
  @IsString()
  serviceId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  link!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.orders.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.userId, dto.serviceId, dto.quantity, dto.link);
  }

  @Post(':id/refill')
  refill(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.refill(user.userId, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.cancel(user.userId, id);
  }
}
