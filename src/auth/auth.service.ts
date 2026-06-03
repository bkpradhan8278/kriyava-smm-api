import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto, LoginDto } from './dto';

const WELCOME_CREDIT = 0;

function makeReferralCode(name: string): string {
  const prefix = name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase().padEnd(4, 'X');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}${rand}`;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private email: EmailService,
  ) {}

  private sign(user: { id: string; email: string }) {
    return this.jwt.sign({ sub: user.id, email: user.email });
  }

  private publicUser(u: { id: string; email: string; name: string; phone: string | null; balance: unknown; spent: unknown; apiKey: string; referralCode?: string | null }) {
    return { id: u.id, email: u.email, name: u.name, phone: u.phone, balance: Number(u.balance), spent: Number(u.spent), apiKey: u.apiKey, referralCode: u.referralCode || null };
  }

  private async clearLegacyWelcomeCredit<T extends { id: string; email: string; name: string; phone: string | null; balance: unknown; spent: unknown; apiKey: string; referralCode?: string | null }>(user: T) {
    const balance = Number(user.balance);
    const spent = Number(user.spent);
    if (balance !== 500 || spent !== 0) return user;
    const [orders, deposits] = await Promise.all([
      this.prisma.order.count({ where: { userId: user.id } }),
      this.prisma.transaction.count({ where: { userId: user.id, type: 'Deposit' } }),
    ]);
    if (orders > 0 || deposits > 0) return user;
    return this.prisma.user.update({ where: { id: user.id }, data: { balance: 0 } });
  }

  private async ensureReferralCode(userId: string, name: string) {
    for (let i = 0; i < 5; i++) {
      const code = makeReferralCode(name);
      const existing = await this.prisma.user.findUnique({ where: { referralCode: code } });
      if (!existing) {
        await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
        return code;
      }
    }
    const fallback = userId.slice(-8).toUpperCase();
    await this.prisma.user.update({ where: { id: userId }, data: { referralCode: fallback } }).catch(() => {});
    return fallback;
  }

  async register(dto: RegisterDto, referralCode?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');
    const hash = await bcrypt.hash(dto.password, 10);

    // Link referrer if code provided
    let referredBy: string | undefined;
    if (referralCode) {
      const referrer = await this.prisma.user.findUnique({ where: { referralCode } });
      if (referrer) referredBy = referrer.id;
    }

    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, password: hash, balance: WELCOME_CREDIT, referredBy },
    });
    const code = await this.ensureReferralCode(user.id, user.name);
    void this.email.sendWelcome(user.email, user.name, code);
    return { token: this.sign(user), user: { ...this.publicUser(user), referralCode: code } };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid email or password');
    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    const cleanUser = await this.clearLegacyWelcomeCredit(user);
    void this.email.sendLoginAlert(cleanUser.email, cleanUser.name);
    return { token: this.sign(cleanUser), user: this.publicUser(cleanUser) };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    // Ensure referral code exists for old users
    if (!user.referralCode) await this.ensureReferralCode(user.id, user.name);
    const cleanUser = await this.clearLegacyWelcomeCredit(user);
    return this.publicUser(cleanUser);
  }

  async social(email: string, name: string, referralCode?: string) {
    let user = await this.prisma.user.findUnique({ where: { email } });
    const isNew = !user;
    if (!user) {
      let referredBy: string | undefined;
      if (referralCode) {
        const referrer = await this.prisma.user.findUnique({ where: { referralCode } });
        if (referrer) referredBy = referrer.id;
      }
      const hash = await bcrypt.hash(`social_${Math.random().toString(36).slice(2)}`, 10);
      user = await this.prisma.user.create({
        data: { email, name: name || 'Creator', password: hash, balance: WELCOME_CREDIT, referredBy },
      });
    }
    if (!user.referralCode) await this.ensureReferralCode(user.id, user.name);
    const cleanUser = await this.clearLegacyWelcomeCredit(user);
    if (isNew) {
      const code = cleanUser.referralCode || user.id.slice(-8).toUpperCase();
      void this.email.sendWelcome(cleanUser.email, cleanUser.name, code);
    }
    return { token: this.sign(cleanUser), user: this.publicUser(cleanUser) };
  }
}
