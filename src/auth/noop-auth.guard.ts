import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * No-op authentication guard. The challenge does not implement authentication,
 * but the code must provide an extension point. This guard always allows
 * requests and is used where authentication would be wired in production.
 */
@Injectable()
export class NoopAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
