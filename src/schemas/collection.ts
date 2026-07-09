import { z } from 'zod';

export const createCollectionSchema = z.object({
  name:  z.string().min(1).max(60),
  emoji: z.string().max(8).optional(),
  color: z.string().max(20).optional(),
});

export const renameCollectionSchema = z.object({
  name:  z.string().min(1).max(60).optional(),
  emoji: z.string().max(8).optional(),
  color: z.string().max(20).optional(),
});

export const addRecipeToCollectionSchema = z.object({
  recipe_id: z.string().uuid(),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type RenameCollectionInput = z.infer<typeof renameCollectionSchema>;
