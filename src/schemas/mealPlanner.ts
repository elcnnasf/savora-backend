import { z } from 'zod';

export const addMealItemSchema = z.object({
  recipe_id:    z.string().uuid().optional(),
  recipe_title: z.string().min(1).max(200),
  meal_type:    z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  day_of_week:  z.number().int().min(0).max(6),
  calories:     z.number().int().positive().optional(),
  notes:        z.string().max(500).optional(),
});

export const weekParamSchema = z.object({
  // ISO date string: YYYY-MM-DD (Monday of the week)
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart must be YYYY-MM-DD'),
});

export type AddMealItemInput = z.infer<typeof addMealItemSchema>;
