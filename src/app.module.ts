import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
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
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    // Global rate limit: 300 requests / minute / IP. Generous enough for reseller
    // API traffic, but caps brute-force on /auth and spam on /v2. Stricter
    // per-route limits are applied with @Throttle (see auth.controller).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
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
  providers: [
    // Catches unhandled exceptions and reports them to Sentry. Must come before
    // any other exception filter (there are none else here).
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
