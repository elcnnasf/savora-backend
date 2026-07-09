import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import authRouter         from './routes/auth';
import recipesRouter      from './routes/recipes';
import aiRouter           from './routes/ai';
import shoppingListRouter from './routes/shoppingList';
import mealPlannerRouter  from './routes/mealPlanner';
import collectionsRouter  from './routes/collections';
import adminRouter        from './routes/admin';
import webhooksRouter     from './routes/webhooks';

const app = express();

// ── Security ──────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: env.allowedOrigins,
    credentials: true,
  }),
);

// ── Rate limiting ──────────────────────────────────────────
if (!env.isDev) {
  app.use(
    '/auth',
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 20,
      message: { success: false, error: 'Too many requests, please try again later' },
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
}

// ── Body parsing ───────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check ───────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ─────────────────────────────────────────────────
app.use('/auth',    authRouter);
app.use('/recipes', recipesRouter);
app.use('/ai',      aiRouter);

app.use('/shopping-list', shoppingListRouter);
app.use('/meal-plans',    mealPlannerRouter);
app.use('/collections',   collectionsRouter);
app.use('/admin',         adminRouter);
app.use('/webhooks',      webhooksRouter);

// Placeholder routes — coming soon
app.use('/profile', (_req, res) => res.json({ success: true, message: 'Profile API — coming soon' }));

// ── 404 ────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ── Error handler (must be last) ───────────────────────────
app.use(errorHandler);

export default app;
