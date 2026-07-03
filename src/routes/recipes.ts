import { Router, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types';
import { recipeQuerySchema, rateRecipeSchema } from '../schemas/recipe';
import { matchRecipesSchema } from '../schemas/ai';
import { validate } from '../middleware/validate';
import * as recipeService from '../services/recipeService';
import * as aiService from '../services/aiService';


const router = Router();

/** GET /recipes?page=1&limit=20&cuisine=Italian&difficulty=easy&max_cook_time=30&tags=healthy,quick&q=chicken */
router.get('/', async (req, res: Response, next: NextFunction) => {
  try {
    const query = recipeQuerySchema.parse(req.query);
    const result = await recipeService.listRecipes(query);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** POST /recipes/match — rank DB recipes by ingredient match % */
router.post('/match', requireAuth, validate(matchRecipesSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await recipeService.matchRecipes(req.body.ingredients);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/** GET /recipes/saved — must be before /:id */
router.get('/saved', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await recipeService.getSavedRecipes(req.user!.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/** GET /recipes/:id/save — check if current user has saved this recipe */
router.get('/:id/save', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const saved = await recipeService.isRecipeSaved(req.user!.id, String(req.params.id));
    res.json({ success: true, data: { saved } });
  } catch (err) { next(err); }
});

/** GET /recipes/:id/rating — current user's own rating for this recipe */
router.get('/:id/rating', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rating = await recipeService.getUserRating(req.user!.id, String(req.params.id));
    res.json({ success: true, data: { rating } });
  } catch (err) { next(err); }
});

/** POST /recipes/:id/rate — Body: { rating: 1-5 } */
router.post('/:id/rate', requireAuth, validate(rateRecipeSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await recipeService.rateRecipe(req.user!.id, String(req.params.id), req.body.rating);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/** GET /recipes/:id?lang=az — lazily translates the recipe to `lang` on first view */
router.get('/:id', async (req, res: Response, next: NextFunction) => {
  try {
    let data = await recipeService.getRecipeById(req.params.id);
    const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;
    if (lang && !data.translations?.[lang]?.steps?.length) {
      try {
        data = await aiService.ensureRecipeTranslation(data, lang);
      } catch {
        // translation is best-effort — serve the recipe untranslated
      }
    }
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/** POST /recipes/:id/save */
router.post('/:id/save', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await recipeService.saveRecipe(req.user!.id, String(req.params.id));
    res.json({ success: true, message: 'Recipe saved' });
  } catch (err) {
    next(err);
  }
});

/** DELETE /recipes/:id/save */
router.delete('/:id/save', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await recipeService.unsaveRecipe(req.user!.id, String(req.params.id));
    res.json({ success: true, message: 'Recipe removed from saved' });
  } catch (err) {
    next(err);
  }
});

export default router;
