import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthRequest } from '../types';
import {
  createCollectionSchema, renameCollectionSchema, addRecipeToCollectionSchema,
} from '../schemas/collection';
import * as collectionService from '../services/collectionService';

const router = Router();

/** GET /collections/shared/:shareId — public view of a shared collection. */
router.get('/shared/:shareId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await collectionService.getSharedCollection(String(req.params.shareId));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/** GET /collections/recipe/:recipeId — which of my collections contain this recipe. */
router.get('/recipe/:recipeId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ids = await collectionService.getCollectionIdsForRecipe(req.user!.id, String(req.params.recipeId));
    res.json({ success: true, data: { collection_ids: ids } });
  } catch (err) { next(err); }
});

/** GET /collections — my collections with counts + cover images. */
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await collectionService.listCollections(req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/** POST /collections — Body: { name, emoji?, color? } */
router.post('/', requireAuth, validate(createCollectionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await collectionService.createCollection(req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

/** GET /collections/:id/recipes — recipes inside one collection. */
router.get('/:id/recipes', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await collectionService.getCollectionRecipes(req.user!.id, String(req.params.id));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/** POST /collections/:id/recipes — Body: { recipe_id } */
router.post('/:id/recipes', requireAuth, validate(addRecipeToCollectionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await collectionService.addRecipeToCollection(req.user!.id, String(req.params.id), req.body.recipe_id);
    res.json({ success: true, message: 'Recipe added to collection' });
  } catch (err) { next(err); }
});

/** DELETE /collections/:id/recipes/:recipeId */
router.delete('/:id/recipes/:recipeId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await collectionService.removeRecipeFromCollection(req.user!.id, String(req.params.id), String(req.params.recipeId));
    res.json({ success: true, message: 'Recipe removed from collection' });
  } catch (err) { next(err); }
});

/** POST /collections/:id/share — enable sharing, returns share slug. */
router.post('/:id/share', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shareId = await collectionService.shareCollection(req.user!.id, String(req.params.id));
    res.json({ success: true, data: { share_id: shareId } });
  } catch (err) { next(err); }
});

/** PATCH /collections/:id — Body: { name?, emoji?, color? } */
router.patch('/:id', requireAuth, validate(renameCollectionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await collectionService.renameCollection(req.user!.id, String(req.params.id), req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/** DELETE /collections/:id */
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await collectionService.deleteCollection(req.user!.id, String(req.params.id));
    res.json({ success: true, message: 'Collection deleted' });
  } catch (err) { next(err); }
});

export default router;
