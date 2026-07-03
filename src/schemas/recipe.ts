import { z } from 'zod';

export const recipeQuerySchema = z.object({
  page:          z.coerce.number().min(1).default(1),
  limit:         z.coerce.number().min(1).max(50).default(20),
  cuisine:       z.string().optional(),
  difficulty:    z.enum(['easy', 'medium', 'hard']).optional(),
  max_cook_time: z.coerce.number().positive().optional(),
  min_rating:    z.coerce.number().min(1).max(5).optional(),
  tags:          z.string().optional(), // comma-separated: "healthy,quick"
  q:             z.string().optional(), // search query
});

export const generateRecipeSchema = z.object({
  // Free-form description OR ingredients list — at least one required
  description: z.string().min(1).max(500).optional(),
  ingredients: z
    .array(z.string().min(1).max(50))
    .max(20, 'Maximum 20 ingredients')
    .optional(),
  preferences: z
    .object({
      dietary_restrictions: z.array(z.string()).optional(),
      cuisine:              z.string().optional(),
      max_cook_time:        z.number().positive().optional(),
      servings:             z.number().min(1).max(10).optional(),
      difficulty:           z.enum(['easy', 'medium', 'hard']).optional(),
    })
    .optional(),
  language: z.string().max(20).optional(),
}).refine(
  (d) => d.description || (d.ingredients && d.ingredients.length > 0),
  { message: 'Provide either a description or at least one ingredient' },
);

export const rateRecipeSchema = z.object({
  rating: z.number().int().min(1).max(5),
});

export type RecipeQuery         = z.infer<typeof recipeQuerySchema>;
export type RateRecipeInput     = z.infer<typeof rateRecipeSchema>;
export type GenerateRecipeInput = z.infer<typeof generateRecipeSchema>;
