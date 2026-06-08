import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { ServicesModule } from './services/services.module';
import { OrdersModule } from './orders/orders.module';
import { TicketsModule } from './tickets/tickets.module';
import { PaymentsModule } from './payments/payments.module';
import { AiModule } from './ai/ai.module';
import { EmailModule } from './email/email.module';
import { ReferralsModule } from './referrals/referrals.module';
import { ApiV2Module } from './apiv2/apiv2.module';
import { LeadsModule } from './leads/leads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EmailModule,
    AuthModule,
    WalletModule,
    ServicesModule,
    OrdersModule,
    TicketsModule,
    PaymentsModule,
    AiModule,
    ReferralsModule,
    ApiV2Module,
    LeadsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
