import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import {
  registerSchema, loginSchema, refreshSchema, googleSchema,
  forgotPasswordSchema, resetPasswordSchema,
} from '../schemas/auth';
import * as authService from '../services/authService';
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
 * POST /auth/subscribe
 * Body: { plan: 'premium' | 'pro' | 'free' }
 * Header: Authorization: Bearer <token>
 */
router.post(
  '/subscribe',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await authService.updateSubscription(req.user!.id, req.body.plan);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
