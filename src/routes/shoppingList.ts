import { Router, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthRequest } from '../types';
import { addItemSchema, updateItemSchema, addBulkSchema } from '../schemas/shoppingList';
import * as svc from '../services/shoppingListService';

const router = Router();
router.use(requireAuth);

/** GET /shopping-list */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await svc.getShoppingList(req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/** POST /shopping-list/items */
router.post('/items', validate(addItemSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await svc.addItem(req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

/** POST /shopping-list/items/bulk — recipe-dən bütün ingredient-ləri əlavə et */
router.post('/items/bulk', validate(addBulkSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await svc.addBulkItems(req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

/** PATCH /shopping-list/items/:id */
router.patch('/items/:id', validate(updateItemSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await svc.updateItem(req.user!.id, String(req.params.id), req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/** DELETE /shopping-list/items/:id */
router.delete('/items/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await svc.deleteItem(req.user!.id, String(req.params.id));
    res.json({ success: true, message: 'Item deleted' });
  } catch (err) { next(err); }
});

/** DELETE /shopping-list/checked — işarələnmiş itemləri sil */
router.delete('/checked', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await svc.clearChecked(req.user!.id);
    res.json({ success: true, message: 'Checked items cleared' });
  } catch (err) { next(err); }
});

/** PATCH /shopping-list/toggle-all */
router.patch('/toggle-all', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const checked = req.body.checked === true;
    const data = await svc.toggleAll(req.user!.id, checked);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

export default router;
