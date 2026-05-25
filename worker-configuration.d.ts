interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOWED_ORIGIN: string;
  APP_URL: string;
  RL_AUTH?: RateLimitBinding;
  RL_WRITE?: RateLimitBinding;
}
