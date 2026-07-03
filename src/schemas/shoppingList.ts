import { z } from 'zod';

export const addItemSchema = z.object({
  name:     z.string().min(1).max(100),
  quantity: z.string().max(50).optional(),
  unit:     z.string().max(30).optional(),
  category: z.string().max(50).optional(),
});

export const updateItemSchema = z.object({
  is_checked: z.boolean().optional(),
  quantity:   z.string().max(50).optional(),
  name:       z.string().min(1).max(100).optional(),
});

export const addBulkSchema = z.object({
  items: z.array(addItemSchema).min(1).max(50),
});

export type AddItemInput    = z.infer<typeof addItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type AddBulkInput    = z.infer<typeof addBulkSchema>;
