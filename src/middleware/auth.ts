import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { verifyJwt } from '../lib/jwt';

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: { userId: string; userEmail: string } }>(
  async (c, next) => {
    // Prefer session cookie; fall back to Authorization: Bearer for migration compat
    const cookie = getCookie(c, 'session');
    const header = c.req.header('Authorization');
    const token = cookie ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    try {
      const payload = await verifyJwt(token, c.env.JWT_SECRET);
      c.set('userId', payload.sub);
      c.set('userEmail', payload.email);
    } catch {
      return c.json({ error: 'Invalid token' }, 401);
    }
    return next();
  },
);
