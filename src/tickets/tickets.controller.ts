import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';

class CreateTicketDto {
  @IsString()
  @MinLength(3)
  subject!: string;

  @IsString()
  category!: string;

  @IsString()
  @MinLength(3)
  message!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const tickets = await this.prisma.ticket.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
    });
    return tickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      category: t.category,
      message: t.message,
      status: t.status,
      at: t.createdAt,
    }));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    const t = await this.prisma.ticket.create({
      data: {
        userId: user.userId,
        subject: dto.subject,
        category: dto.category,
        message: dto.message,
      },
    });
    return { id: t.id, status: t.status, at: t.createdAt };
  }
}
