import { createMiddleware } from 'hono/factory';
import { verifyJwt } from '../lib/jwt';

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: { userId: string; userEmail: string } }>(
  async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    try {
      const payload = await verifyJwt(header.slice(7), c.env.JWT_SECRET);
      c.set('userId', payload.sub);
      c.set('userEmail', payload.email);
    } catch {
      return c.json({ error: 'Invalid token' }, 401);
    }
    return next();
  },
);
