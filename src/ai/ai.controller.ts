import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';

type ChatRole = 'user' | 'model';

export interface AiChatBody {
  prompt?: string;
  surface?: 'dashboard' | 'landing';
  messages?: Array<{ role: ChatRole; text: string }>;
  context?: Record<string, unknown>;
}

@Controller('ai')
export class AiController {
  constructor(private ai: AiService) {}

  @Post('chat')
  chat(@Body() body: AiChatBody) {
    return this.ai.chat(body);
  }
}
