import { createMiddleware } from 'hono/factory';

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

type RateLimitEnv = Env & { RL_AUTH?: RateLimitBinding; RL_WRITE?: RateLimitBinding };

export const authRateLimit = createMiddleware<{ Bindings: RateLimitEnv }>(async (c, next) => {
  const rl = c.env.RL_AUTH;
  if (!rl) return next();
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { success } = await rl.limit({ key: ip });
  if (!success) return c.json({ error: 'Too many requests' }, 429);
  return next();
});

export const writeRateLimit = createMiddleware<{ Bindings: RateLimitEnv; Variables: { userId: string } }>(
  async (c, next) => {
    const rl = c.env.RL_WRITE;
    if (!rl) return next();
    const userId = c.get('userId');
    const { success } = await rl.limit({ key: userId ?? 'unknown' });
    if (!success) return c.json({ error: 'Too many requests' }, 429);
    return next();
  },
);
