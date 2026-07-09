import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isDev: process.env.NODE_ENV !== 'production',

  supabase: {
    url: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  groq: {
    apiKey: required('GROQ_API_KEY'),
  },

  // Optional — when set, Gemini becomes the primary AI provider and Groq the fallback
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
  },

  pexelsApiKey: process.env.PEXELS_API_KEY ?? '',
  serperApiKey: process.env.SERPER_API_KEY ?? '',

  // RevenueCat (subscriptions). When secretKey is set, /auth/subscribe verifies
  // entitlements against the RevenueCat API instead of trusting the client.
  revenuecat: {
    secretKey: process.env.REVENUECAT_SECRET_KEY ?? '',
    webhookAuth: process.env.REVENUECAT_WEBHOOK_AUTH ?? '',
  },

  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:8081').split(','),
} as const;
