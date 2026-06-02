import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsNumber } from 'class-validator';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';

class AddFundsDto {
  @IsNumber()
  amount!: number;
}

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Get('balance')
  balance(@CurrentUser() user: AuthUser) {
    return this.wallet.balance(user.userId);
  }

  @Post('add-funds')
  addFunds(@CurrentUser() user: AuthUser, @Body() dto: AddFundsDto) {
    return this.wallet.addFunds(user.userId, dto.amount);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser) {
    return this.wallet.transactions(user.userId);
  }
}
