import { Body, Controller, Post, HttpCode, BadRequestException } from '@nestjs/common';
import { IsString, IsOptional, IsEmail, MinLength, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

class ContactDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional() @IsString() @MaxLength(40)
  subject?: string;

  @IsString() @MinLength(3) @MaxLength(2000)
  message!: string;
}

@Controller('leads')
export class LeadsController {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  // Public — the marketing "Contact Support" form posts here.
  @Post('contact')
  @HttpCode(200)
  async contact(@Body() dto: ContactDto) {
    if (!dto.message?.trim()) throw new BadRequestException('Message is required');
    const lead = await this.prisma.lead.create({
      data: {
        source: 'contact',
        name: dto.name,
        email: dto.email,
        subject: dto.subject || 'general',
        message: dto.message,
      },
    });
    // Notify admin inbox (best-effort)
    void this.email.sendContactLead(dto.name, dto.email, dto.subject || 'general', dto.message).catch(() => {});
    return { ok: true, id: lead.id };
  }
}
