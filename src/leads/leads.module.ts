import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LeadsController } from './leads.controller';

@Module({
  imports: [PrismaModule],
  controllers: [LeadsController],
})
export class LeadsModule {}
