import { Body, Controller, Get, Post, Req, Headers, HttpCode, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { IsNumber, IsString } from 'class-validator';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';

class CreateOrderDto {
  @IsNumber()
  amount!: number;
}

class VerifyDto {
  @IsString() razorpay_order_id!: string;
  @IsString() razorpay_payment_id!: string;
  @IsString() razorpay_signature!: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  // public — lets the frontend know whether to show the Razorpay button
  @Get('config')
  config() {
    return { provider: 'razorpay', enabled: this.payments.isConfigured() };
  }

  @UseGuards(JwtAuthGuard)
  @Post('create-order')
  createOrder(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.payments.createOrder(user.userId, dto.amount);
  }

  // Public, server-to-server from Razorpay. No JWT (signature-verified instead),
  // and exempt from the IP rate limiter since all calls come from Razorpay's IPs.
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    return this.payments.handleWebhook(req.rawBody ?? Buffer.from(''), signature);
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify')
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyDto) {
    return this.payments.verify(
      user.userId,
      dto.razorpay_order_id,
      dto.razorpay_payment_id,
      dto.razorpay_signature,
    );
  }
}
