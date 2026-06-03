import { Controller, Get, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Get('balance')
  balance(@CurrentUser() user: AuthUser) {
    return this.wallet.balance(user.userId);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser) {
    return this.wallet.transactions(user.userId);
  }
}
