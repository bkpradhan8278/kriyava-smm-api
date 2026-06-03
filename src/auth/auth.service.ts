import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto';

const WELCOME_CREDIT = 0; // no free credit — users add funds via payment

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private sign(user: { id: string; email: string }) {
    return this.jwt.sign({ sub: user.id, email: user.email });
  }

  private publicUser(u: {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    balance: unknown;
    spent: unknown;
    apiKey: string;
  }) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      phone: u.phone,
      balance: Number(u.balance),
      spent: Number(u.spent),
      apiKey: u.apiKey,
    };
  }

  private async clearLegacyWelcomeCredit<
    T extends {
      id: string;
      email: string;
      name: string;
      phone: string | null;
      balance: unknown;
      spent: unknown;
      apiKey: string;
    },
  >(user: T) {
    const balance = Number(user.balance);
    const spent = Number(user.spent);
    if (balance !== 500 || spent !== 0) return user;

    const [orders, deposits] = await Promise.all([
      this.prisma.order.count({ where: { userId: user.id } }),
      this.prisma.transaction.count({ where: { userId: user.id, type: 'Deposit' } }),
    ]);
    if (orders > 0 || deposits > 0) return user;

    return this.prisma.user.update({
      where: { id: user.id },
      data: { balance: 0 },
    });
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');
    const hash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, password: hash, balance: WELCOME_CREDIT },
    });
    return { token: this.sign(user), user: this.publicUser(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid email or password');
    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    const cleanUser = await this.clearLegacyWelcomeCredit(user);
    return { token: this.sign(cleanUser), user: this.publicUser(cleanUser) };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const cleanUser = await this.clearLegacyWelcomeCredit(user);
    return this.publicUser(cleanUser);
  }

  // Social sign-in (Google via Firebase). The frontend verifies the user with
  // Firebase, then sends the verified email + name here. We upsert the account
  // and issue our own JWT. A random password is stored so the row is valid;
  // social users sign in only through this endpoint.
  async social(email: string, name: string) {
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      const hash = await bcrypt.hash(`social_${Math.random().toString(36).slice(2)}`, 10);
      user = await this.prisma.user.create({
        data: { email, name: name || 'Creator', password: hash, balance: WELCOME_CREDIT },
      });
    }
    const cleanUser = await this.clearLegacyWelcomeCredit(user);
    return { token: this.sign(cleanUser), user: this.publicUser(cleanUser) };
  }
}
