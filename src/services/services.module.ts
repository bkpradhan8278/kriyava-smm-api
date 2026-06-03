import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';

@Module({
  imports: [ConfigModule],
  providers: [ServicesService],
  controllers: [ServicesController],
  exports: [ServicesService],
})
export class ServicesModule {}
