import { Router, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthRequest } from '../types';
import { generateRecipeSchema } from '../schemas/recipe';
import { chatSchema, mealPlanSchema, scanIngredientsSchema, suggestRecipesSchema, analyzeCaloriesSchema } from '../schemas/ai';
import * as aiService from '../services/aiService';

const router = Router();
router.use(requireAuth);

/**
 * POST /ai/generate-recipe
 */
router.post(
  '/generate-recipe',
  validate(generateRecipeSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const recipe = await aiService.generateRecipe(
        req.body,
        req.user!.id,
        req.user!.is_premium,
        req.user!.is_admin,
        req.user!.is_pro,
      );
      res.status(201).json({ success: true, data: recipe });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /ai/chat
 * Body: { message: string, history?: [{role, content}][] }
 */
router.post(
  '/chat',
  validate(chatSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await aiService.chatWithAI(
        req.body,
        req.user!.id,
        req.user!.is_premium,
        req.user!.is_admin,
        req.user!.is_pro,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /ai/meal-plan
 * Body: { week_start, location?, budget?, calorie_goal?, dietary_preferences? }
 */
router.post(
  '/meal-plan',
  validate(mealPlanSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await aiService.generateMealPlan(
        req.body,
        req.user!.id,
        req.user!.is_premium,
        req.user!.is_admin,
        req.user!.is_pro,
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /ai/suggest-recipes
 * Body: { query: string, language?: string }
 * Returns: { suggestions: RecipeSuggestion[] }
 */
router.post(
  '/suggest-recipes',
  validate(suggestRecipesSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await aiService.suggestRecipes(
        req.body,
        req.user!.id,
        req.user!.is_premium,
        req.user!.is_admin,
        req.user!.is_pro,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /ai/scan-ingredients
 * Body: { image_base64: string }
 * Returns: { ingredients: string[] }
 */
router.post(
  '/scan-ingredients',
  validate(scanIngredientsSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await aiService.scanIngredients(req.body.image_base64);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /ai/analyze-calories  (Premium/Pro only)
 * Body: { image_base64?: string, food_name?: string, portion?: string, language?: string }
 * Returns: CalorieAnalysis
 */
router.post(
  '/analyze-calories',
  validate(analyzeCaloriesSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await aiService.analyzeCalories(
        req.body,
        req.user!.id,
        req.user!.is_premium,
        req.user!.is_admin,
        req.user!.is_pro,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
