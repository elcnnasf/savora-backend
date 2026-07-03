import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from './errorHandler';
import { AuthRequest } from '../types';

const ADMIN_EMAIL = 'savorachef@gmail.com';

export async function requireAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing authorization token');
    }

    const token = header.slice(7);

    // Verify token against Supabase — also validates expiry
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      throw new AppError(401, 'Invalid or expired token');
    }

    // Fetch profile for name + premium status
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name, is_premium, is_pro')
      .eq('id', user.id)
      .single();

    const email = user.email ?? '';
    req.user = {
      id: user.id,
      email,
      name: profile?.name ?? '',
      is_premium: profile?.is_premium ?? false,
      is_pro:     profile?.is_pro     ?? false,
      is_admin:   email === ADMIN_EMAIL,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requirePremium(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user?.is_premium) {
    next(new AppError(403, 'Premium subscription required'));
    return;
  }
  next();
}

export function requireAdmin(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void {
  if (req.user?.email !== ADMIN_EMAIL) {
    next(new AppError(403, 'Admin access required'));
    return;
  }
  next();
}
