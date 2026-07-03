import { Router, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthRequest } from '../types';
import { addMealItemSchema, weekParamSchema } from '../schemas/mealPlanner';
import * as svc from '../services/mealPlannerService';

const router = Router();
router.use(requireAuth);

/**
 * GET /meal-plans/week/:weekStart
 * weekStart = ISO date of Monday (e.g. 2026-06-22)
 */
router.get('/week/:weekStart', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { weekStart } = weekParamSchema.parse(req.params);
    const data = await svc.getWeekPlan(req.user!.id, weekStart);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/**
 * POST /meal-plans/week/:weekStart/items
 * Body: { recipe_id?, recipe_title, meal_type, day_of_week, calories?, notes? }
 */
router.post('/week/:weekStart/items', validate(addMealItemSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { weekStart } = weekParamSchema.parse(req.params);
    const data = await svc.addMealItem(req.user!.id, weekStart, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

/**
 * DELETE /meal-plans/items/:id
 */
router.delete('/items/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await svc.deleteMealItem(req.user!.id, String(req.params.id));
    res.json({ success: true, message: 'Meal removed from plan' });
  } catch (err) { next(err); }
});

/**
 * DELETE /meal-plans/week/:weekStart/day/:day
 * day = 0 (Mon) - 6 (Sun)
 */
router.delete('/week/:weekStart/day/:day', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { weekStart } = weekParamSchema.parse(req.params);
    const day = parseInt(String(req.params.day), 10);
    if (isNaN(day) || day < 0 || day > 6) {
      res.status(400).json({ success: false, error: 'day must be 0-6' });
      return;
    }
    await svc.clearDayMeals(req.user!.id, weekStart, day);
    res.json({ success: true, message: 'Day meals cleared' });
  } catch (err) { next(err); }
});

export default router;
