import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';

@Module({ controllers: [ReferralsController] })
export class ReferralsModule {}
