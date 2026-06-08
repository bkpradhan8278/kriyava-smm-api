import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { AiChatBody } from './ai.controller';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  // Store the chat turn as a lead (fire-and-forget) so admins can see what people ask.
  private logLead(body: AiChatBody, prompt: string, reply: string) {
    const ctx = body.context || {};
    const email = typeof ctx.email === 'string' ? ctx.email : null;
    const name = typeof ctx.name === 'string' ? ctx.name : null;
    void this.prisma.lead
      .create({
        data: {
          source: 'ai_chat',
          name,
          email,
          subject: body.surface === 'dashboard' ? 'Dashboard chat' : 'Landing chat',
          message: prompt.slice(0, 2000),
          meta: JSON.stringify({ reply: reply.slice(0, 1500), surface: body.surface || 'landing' }),
        },
      })
      .catch(() => {});
  }

  async chat(body: AiChatBody) {
    const prompt = String(body.prompt || '').trim();
    if (!prompt) throw new BadRequestException('Prompt is required');
    if (prompt.length > 1200) throw new BadRequestException('Prompt is too long');

    const key = this.config.get<string>('GEMINI_API_KEY');
    const model = this.config.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
    if (!key) {
      const reply = this.fallback(prompt, body.surface || 'landing');
      this.logLead(body, prompt, reply);
      return { provider: 'fallback', reply };
    }

    const surface = body.surface === 'dashboard' ? 'dashboard' : 'landing';
    const system = this.systemPrompt(surface, body.context || {});
    const recent = (body.messages || [])
      .slice(-8)
      .filter((m) => (m.role === 'user' || m.role === 'model') && m.text?.trim())
      .map((m) => ({ role: m.role, parts: [{ text: m.text.slice(0, 1200) }] }));

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [...recent, { role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.35, maxOutputTokens: 420 },
        }),
      },
    );

    const data = (await res.json()) as GeminiResponse;
    if (!res.ok) {
      this.logger.warn(`Gemini request failed: ${res.status} ${data.error?.message || 'unknown error'}`);
      const reply = this.fallback(prompt, surface);
      this.logLead(body, prompt, reply);
      return { provider: 'fallback', reply };
    }
    const reply = (data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim()) || this.fallback(prompt, surface);
    this.logLead(body, prompt, reply);
    return { provider: 'gemini', reply };
  }

  private systemPrompt(surface: 'dashboard' | 'landing', context: Record<string, unknown>) {
    const shared =
      'You are Kriyava AI, a concise assistant for Kriyava SMM. Answer in friendly Indian English/Odia mix when the user writes that way. Do not claim to place orders or take payment yourself. Tell users payments and wallet credits happen only through verified Razorpay backend flow. Keep answers under 120 words.';
    if (surface === 'dashboard') {
      return `${shared} Use dashboard context when provided: ${JSON.stringify(context).slice(0, 1500)}. Help with service choice, balance explanation, settings, add funds, and order guidance.`;
    }
    return `${shared} You are on the public landing page. Explain pricing, safety, platforms, refunds/refills, and how to start. Do not ask for passwords.`;
  }

  private fallback(prompt: string, surface: 'dashboard' | 'landing') {
    const q = prompt.toLowerCase();
    if (q.includes('payment') || q.includes('fund') || q.includes('razorpay')) {
      return 'You can add funds from Add Funds. Minimum top-up is Rs 10, and wallet credit happens only after Razorpay payment verification.';
    }
    if (q.includes('price') || q.includes('rate') || q.includes('cheap')) {
      return 'Service rates vary by platform and quality. In the dashboard, open Services or New Order, then sort by price and quality before ordering.';
    }
    if (surface === 'dashboard') {
      return 'I can help you choose services, explain your wallet/orders, and guide add-funds. Tell me the platform, service type, and quantity you want.';
    }
    return 'Kriyava helps you buy social media growth services from one wallet-based dashboard. Create an account, add funds, choose a service, paste your link, and place the order.';
  }
}
