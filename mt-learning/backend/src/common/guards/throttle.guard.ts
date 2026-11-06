import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/**
 * Rate-limit key per client.
 *
 * A whole hostel's tablets usually reach the server through one Wi-Fi/NAT address, so limiting
 * by IP alone would lock out every student at once. Instead:
 *  - signed-in requests are limited per session (hash of the bearer token);
 *  - sign-in requests are limited per IP + account identifier;
 *  - anything else falls back to the IP.
 * Brute force against a single account is additionally stopped by account lockout.
 */
@Injectable()
export class SmartThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const auth = req.headers?.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return 'tok:' + createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 32);
    }
    const id = req.body?.studentCode ?? req.body?.email;
    const ip = req.ip ?? 'unknown';
    if (typeof id === 'string' && id.length <= 254) return `id:${ip}:${id.trim().toLowerCase()}`;
    return `ip:${ip}`;
  }
}
