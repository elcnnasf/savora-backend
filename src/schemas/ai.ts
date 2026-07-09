import { z } from 'zod';

export const chatMessageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
});

export const chatSchema = z.object({
  message: z.string().min(1, 'Message is required').max(1000),
  history: z.array(chatMessageSchema).max(20).optional().default([]),
  language: z.string().max(20).optional(),
  // Live cooking context (recipe name + current step) when the chat is opened
  // from Cooking Mode, so the assistant can answer for THIS step specifically.
  context: z.string().max(2000).optional(),
});

export const mealPlanSchema = z.object({
  language:             z.string().max(20).optional(),
  week_start:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  location:             z.string().max(100).optional(),
  budget:               z.enum(['budget', 'moderate', 'premium']).optional(),
  calorie_goal:         z.number().min(500).max(10000).optional(),
  dietary_preferences:  z.array(z.string().max(50)).max(20).optional(),
  spice_level:          z.string().max(20).optional(),
  cuisine_preference:   z.string().max(100).optional(),
  today_day_index:      z.number().int().min(0).max(6).optional(),
  allergies:            z.array(z.string().max(50)).max(20).optional(),
  disliked_ingredients: z.array(z.string().max(50)).max(30).optional(),
  favorite_proteins:    z.array(z.string().max(30)).max(10).optional(),
  meals_per_day:        z.number().int().min(2).max(6).optional(),
  health_goal:          z.string().max(40).optional(),
});

export const scanIngredientsSchema = z.object({
  image_base64: z.string().min(10, 'Image data required'),
});

export const matchRecipesSchema = z.object({
  ingredients: z.array(z.string().min(1).max(100)).min(1).max(30),
});

export const suggestRecipesSchema = z.object({
  query:    z.string().min(1, 'Query required').max(200),
  language: z.string().max(20).optional(),
});

// Photo mode sends image_base64; text mode sends food_name (+ optional portion)
export const analyzeCaloriesSchema = z
  .object({
    image_base64: z.string().min(10).optional(),
    food_name:    z.string().min(1).max(200).optional(),
    portion:      z.string().max(100).optional(),
    language:     z.string().max(20).optional(),
  })
  .refine((d) => d.image_base64 || d.food_name, {
    message: 'image_base64 or food_name required',
  });

export type ChatInput             = z.infer<typeof chatSchema>;
export type MealPlanInput         = z.infer<typeof mealPlanSchema>;
export type ScanIngredientsInput  = z.infer<typeof scanIngredientsSchema>;
export type MatchRecipesInput     = z.infer<typeof matchRecipesSchema>;
export type SuggestRecipesInput   = z.infer<typeof suggestRecipesSchema>;
export type AnalyzeCaloriesInput  = z.infer<typeof analyzeCaloriesSchema>;
