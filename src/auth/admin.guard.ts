import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

const ADMIN_EMAIL = 'getkriyava@gmail.com';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: { email?: string } }>();
    if (req.user?.email !== ADMIN_EMAIL) throw new ForbiddenException('Admin access only');
    return true;
  }
}
