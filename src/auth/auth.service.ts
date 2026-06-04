import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto, LoginDto } from './dto';

// --- Firebase ID-token verification via Google's public keys (no Web API key required) ---

const _fbKeyCache: { keys: Record<string, string>; exp: number } = { keys: {}, exp: 0 };

async function fetchFirebasePublicKey(kid: string): Promise<string> {
  if (Date.now() < _fbKeyCache.exp && _fbKeyCache.keys[kid]) {
    return _fbKeyCache.keys[kid];
  }
  let res: Response;
  try {
    res = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    );
  } catch {
    throw new Error('Could not reach Google key server');
  }
  if (!res.ok) throw new Error(`Google key server returned ${res.status}`);
  const keys = (await res.json()) as Record<string, string>;
  _fbKeyCache.keys = keys;
  _fbKeyCache.exp = Date.now() + 3_600_000;
  const key = keys[kid];
  if (!key) throw new Error(`No public key for kid=${kid}`);
  return key;
}

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

  // Verifies a Firebase ID token by checking its RS256 signature against Google's published
  // public keys and validating standard JWT claims. No Web API key or service account required.
  private async verifyFirebaseIdToken(idToken: string): Promise<{ email: string; name: string }> {
    const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kriyava-9d099';
    const b64 = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/');

    const parts = idToken.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid Firebase token format');

    let header: { kid?: string; alg?: string };
    let payload: {
      sub?: string; email?: string; name?: string; email_verified?: boolean;
      iss?: string; aud?: string; exp?: number;
    };
    try {
      header = JSON.parse(Buffer.from(b64(parts[0]), 'base64').toString('utf8'));
      payload = JSON.parse(Buffer.from(b64(parts[1]), 'base64').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed Firebase token');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now)
      throw new UnauthorizedException('Firebase token has expired — please sign in again');
    if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`)
      throw new UnauthorizedException('Firebase token issuer mismatch');
    if (payload.aud !== PROJECT_ID)
      throw new UnauthorizedException('Firebase token audience mismatch');
    if (!payload.email)
      throw new UnauthorizedException('Firebase token has no email claim');
    if (!payload.email_verified)
      throw new UnauthorizedException('Google account email is not verified');
    if (!header.kid || header.alg !== 'RS256')
      throw new UnauthorizedException('Firebase token uses unsupported algorithm');

    let publicKey: string;
    try {
      publicKey = await fetchFirebasePublicKey(header.kid);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Firebase] Failed to fetch public key:', msg);
      throw new UnauthorizedException('Google sign-in temporarily unavailable — please try again');
    }

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    const valid = verifier.verify(publicKey, Buffer.from(b64(parts[2]), 'base64'));
    if (!valid) throw new UnauthorizedException('Firebase token signature is invalid');

    return { email: payload.email, name: payload.name || 'Creator' };
  }

  async social(idToken: string, referralCode?: string) {
    const { email, name } = await this.verifyFirebaseIdToken(idToken);

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
