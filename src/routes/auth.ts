import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import {
  registerSchema, loginSchema, refreshSchema, googleSchema,
  forgotPasswordSchema, resetPasswordSchema, updateProfileSchema,
} from '../schemas/auth';
import * as authService from '../services/authService';
import * as subscriptionService from '../services/subscriptionService';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

const router = Router();

/**
 * POST /auth/register
 * Body: { name, email, password }
 */
router.post(
  '/register',
  validate(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.register(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /auth/login
 * Body: { email, password }
 */
router.post(
  '/login',
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.login(req.body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /auth/google
 * Body: { id_token }
 */
router.post(
  '/google',
  validate(googleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.googleSignIn(req.body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /auth/forgot-password
 * Body: { email } — sends a 6-digit reset code to the email
 */
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.forgotPassword(req.body);
      res.json({ success: true, message: 'If the email exists, a reset code has been sent' });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /auth/reset-password
 * Body: { email, token, new_password }
 */
router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.resetPassword(req.body);
      res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /auth/refresh
 * Body: { refresh_token }
 */
router.post(
  '/refresh',
  validate(refreshSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.refreshToken(req.body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /auth/logout
 * Header: Authorization: Bearer <token>
 */
router.post(
  '/logout',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization!.slice(7);
      await authService.logout(token);
      res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /auth/me
 * Header: Authorization: Bearer <token>
 */
router.get(
  '/me',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const profile = await authService.getMe(req.user!.id);
      res.json({ success: true, data: { ...profile, email: req.user!.email } });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /auth/me — update display name and/or preset avatar
 * Body: { name?, avatar_url? }
 */
router.patch(
  '/me',
  requireAuth,
  validate(updateProfileSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const profile = await authService.updateProfile(req.user!.id, req.body);
      res.json({ success: true, data: { ...profile, email: req.user!.email } });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /auth/me — permanently delete the account and all its data
 */
router.delete(
  '/me',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await authService.deleteAccount(req.user!.id);
      res.json({ success: true, message: 'Account deleted' });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /auth/subscribe
 * Body: { plan: 'premium' | 'pro' | 'free' }  (advisory only — see below)
 * Header: Authorization: Bearer <token>
 *
 * With RevenueCat configured, the requested plan is IGNORED: entitlements are
 * verified against the RevenueCat API and mirrored into the profile, so the
 * client can never grant itself a plan. Without RevenueCat the old trusting
 * behavior remains as a dev-only simulator and is refused in production.
 */
router.post(
  '/subscribe',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (subscriptionService.isRevenueCatEnabled()) {
        const result = await subscriptionService.syncSubscription(req.user!.id);
        res.json({ success: true, data: result });
        return;
      }
      if (!env.isDev) {
        throw new AppError(503, 'Payments are not configured on this server');
      }
      const result = await authService.updateSubscription(req.user!.id, req.body.plan);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /auth/preferences — the account's saved Taste Preferences (or null)
 */
router.get(
  '/preferences',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const taste_prefs = await authService.getTastePrefs(req.user!.id);
      res.json({ success: true, data: { taste_prefs } });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /auth/preferences
 * Body: { taste_prefs: { ...full wizard answers } }
 */
router.put(
  '/preferences',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const prefs = req.body?.taste_prefs;
      if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
        res.status(400).json({ success: false, error: 'taste_prefs object required' });
        return;
      }
      if (JSON.stringify(prefs).length > 20_000) {
        res.status(400).json({ success: false, error: 'taste_prefs too large' });
        return;
      }
      await authService.saveTastePrefs(req.user!.id, prefs);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
