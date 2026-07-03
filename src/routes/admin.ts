import { Router, Response, NextFunction } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.use(requireAuth, requireAdmin);

/** GET /admin/recipes?page=1&limit=50&q= */
router.get('/recipes', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  ?? 1)));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50))));
    const q     = String(req.query.q ?? '').trim();
    const offset = (page - 1) * limit;

    let builder = supabaseAdmin
      .from('recipes')
      .select('id, title, image_url, cuisine, difficulty, cook_time, calories, is_ai_generated, created_at', { count: 'exact' });

    if (q) builder = builder.ilike('title', `%${q}%`);

    const { data, error, count } = await builder
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new AppError(500, error.message);

    res.json({ success: true, data: { items: data ?? [], total: count ?? 0, page, limit, hasMore: offset + limit < (count ?? 0) } });
  } catch (err) { next(err); }
});

/** PATCH /admin/recipes/:id */
router.patch('/recipes/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, image_url } = req.body as { title?: string; image_url?: string };
    const update: Record<string, string> = {};
    if (title)     update.title     = title.trim();
    if (image_url) update.image_url = image_url.trim();

    if (Object.keys(update).length === 0) {
      throw new AppError(400, 'Nothing to update');
    }

    const { error } = await supabaseAdmin
      .from('recipes')
      .update(update)
      .eq('id', req.params.id);

    if (error) throw new AppError(500, error.message);
    res.json({ success: true });
  } catch (err) { next(err); }
});

/** DELETE /admin/recipes/:id */
router.delete('/recipes/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { error } = await supabaseAdmin
      .from('recipes')
      .delete()
      .eq('id', req.params.id);

    if (error) throw new AppError(500, error.message);
    res.json({ success: true });
  } catch (err) { next(err); }
});

/** PATCH /admin/users/:id/premium */
router.patch('/users/:id/premium', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { is_premium } = req.body as { is_premium: boolean };
    if (typeof is_premium !== 'boolean') throw new AppError(400, 'is_premium must be boolean');

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ is_premium, premium_since: is_premium ? new Date().toISOString() : null })
      .eq('id', req.params.id);

    if (error) throw new AppError(500, error.message);
    res.json({ success: true });
  } catch (err) { next(err); }
});

/** PATCH /admin/users/:id/pro */
router.patch('/users/:id/pro', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { is_pro } = req.body as { is_pro: boolean };
    if (typeof is_pro !== 'boolean') throw new AppError(400, 'is_pro must be boolean');

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ is_pro, pro_since: is_pro ? new Date().toISOString() : null })
      .eq('id', req.params.id);

    if (error) throw new AppError(500, error.message);
    res.json({ success: true });
  } catch (err) { next(err); }
});

/** GET /admin/users?page=1&limit=50 */
router.get('/users', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  ?? 1)));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50))));
    const offset = (page - 1) * limit;

    const { data: authList, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: limit });
    if (authErr) throw new AppError(500, authErr.message);

    const userIds = (authList?.users ?? []).map((u) => u.id);

    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, name, is_premium, is_pro, member_since, cooking_skill')
      .in('id', userIds);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const users = (authList?.users ?? []).map((u) => ({
      id:           u.id,
      email:        u.email,
      created_at:   u.created_at,
      last_sign_in: u.last_sign_in_at,
      name:          profileMap.get(u.id)?.name          ?? '',
      is_premium:    profileMap.get(u.id)?.is_premium    ?? false,
      is_pro:        profileMap.get(u.id)?.is_pro        ?? false,
      member_since:  profileMap.get(u.id)?.member_since  ?? u.created_at,
      cooking_skill: profileMap.get(u.id)?.cooking_skill ?? 'beginner',
    }));

    res.json({ success: true, data: { items: users, total: authList?.total ?? users.length, page, limit } });
  } catch (err) { next(err); }
});

export default router;
