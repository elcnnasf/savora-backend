import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { RecipeQuery } from '../schemas/recipe';

export async function listRecipes(query: RecipeQuery) {
  const { page, limit, cuisine, difficulty, max_cook_time, min_rating, tags, q } = query;
  const offset = (page - 1) * limit;

  let builder = supabaseAdmin
    .from('recipes')
    .select('*', { count: 'exact' });

  if (q) {
    // Search the base title and all translated titles so queries work in any app language
    const pat = `%${q}%`;
    builder = builder.or(
      [
        `title.ilike.${pat}`,
        `translations->az->>title.ilike.${pat}`,
        `translations->ru->>title.ilike.${pat}`,
        `translations->tr->>title.ilike.${pat}`,
      ].join(','),
    );
  }
  if (cuisine) {
    builder = builder.ilike('cuisine', `%${cuisine}%`);
  }
  if (difficulty) {
    builder = builder.eq('difficulty', difficulty);
  }
  if (max_cook_time) {
    builder = builder.lte('cook_time', max_cook_time);
  }
  if (min_rating) {
    builder = builder.gte('rating_avg', min_rating);
  }
  if (tags) {
    // Tags are stored lowercase — normalize the filter so matching is case-insensitive
    const tagList = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tagList.length > 0) {
      builder = builder.overlaps('tags', tagList);
    }
  }

  const { data, error, count } = await builder
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new AppError(500, error.message);

  return {
    items:   data ?? [],
    total:   count ?? 0,
    page,
    limit,
    hasMore: offset + limit < (count ?? 0),
  };
}

export async function getRecipeById(id: string) {
  const { data, error } = await supabaseAdmin
    .from('recipes')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) throw new AppError(404, 'Recipe not found');
  return data;
}

export async function isRecipeSaved(userId: string, recipeId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('saved_recipes')
    .select('recipe_id')
    .eq('user_id', userId)
    .eq('recipe_id', recipeId)
    .maybeSingle();
  return !!data;
}

export async function createRecipe(recipe: {
  title: string;
  description?: string;
  image_url?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  cook_time: number;
  prep_time?: number;
  servings?: number;
  difficulty?: string;
  cuisine?: string;
  tags?: string[];
  ingredients: { name: string; amount: string }[];
  steps: { step: number; instruction: string; duration?: number }[];
  translations?: Record<string, any>;
  is_ai_generated?: boolean;
  created_by?: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('recipes')
    .insert(recipe)
    .select()
    .single();

  if (error) throw new AppError(500, error.message);
  return data;
}

export async function rateRecipe(userId: string, recipeId: string, rating: number) {
  await getRecipeById(recipeId); // 404s if the recipe doesn't exist

  const { error } = await supabaseAdmin
    .from('recipe_ratings')
    .upsert(
      { user_id: userId, recipe_id: recipeId, rating, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,recipe_id' },
    );
  if (error) throw new AppError(500, error.message);

  // Recompute aggregates onto the recipe row so lists get them without a join
  const { data: rows, error: aggErr } = await supabaseAdmin
    .from('recipe_ratings')
    .select('rating')
    .eq('recipe_id', recipeId);
  if (aggErr) throw new AppError(500, aggErr.message);

  const rating_count = rows?.length ?? 0;
  const rating_avg = rating_count
    ? Math.round((rows!.reduce((s, r: any) => s + r.rating, 0) / rating_count) * 100) / 100
    : null;

  const { error: upErr } = await supabaseAdmin
    .from('recipes')
    .update({ rating_avg, rating_count })
    .eq('id', recipeId);
  if (upErr) throw new AppError(500, upErr.message);

  return { rating_avg, rating_count, user_rating: rating };
}

export async function getUserRating(userId: string, recipeId: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from('recipe_ratings')
    .select('rating')
    .eq('user_id', userId)
    .eq('recipe_id', recipeId)
    .maybeSingle();
  return data?.rating ?? null;
}

export async function updateRecipeTranslations(id: string, translations: Record<string, any>) {
  const { error } = await supabaseAdmin
    .from('recipes')
    .update({ translations })
    .eq('id', id);

  if (error) throw new AppError(500, error.message);
}

export async function getSavedRecipes(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('saved_recipes')
    .select('recipe_id, saved_at, recipes(*)')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });

  if (error) throw new AppError(500, error.message);
  return data?.map((row: any) => ({ ...row.recipes, saved_at: row.saved_at })) ?? [];
}

export async function saveRecipe(userId: string, recipeId: string) {
  const { error } = await supabaseAdmin
    .from('saved_recipes')
    .insert({ user_id: userId, recipe_id: recipeId });

  if (error) {
    if (error.code === '23505') throw new AppError(409, 'Recipe already saved');
    throw new AppError(500, error.message);
  }
}

export async function matchRecipes(ingredients: string[]) {
  // Fetch all recipes with their ingredients
  const { data, error } = await supabaseAdmin
    .from('recipes')
    .select('id, title, image_url, cuisine, difficulty, cook_time, calories, servings, tags, ingredients, translations')
    .order('created_at', { ascending: false });

  if (error) throw new AppError(500, error.message);
  if (!data || data.length === 0) return [];

  const userIngredients = ingredients.map((i) => i.toLowerCase().trim());

  const scored = data.map((recipe: any) => {
    const recipeIngredients: { name: string }[] = recipe.ingredients ?? [];
    const recipeNames = recipeIngredients.map((ri) => ri.name?.toLowerCase()?.trim() ?? '');

    if (recipeNames.length === 0) return null;

    let matched = 0;
    const matchedNames: string[] = [];

    for (const ri of recipeNames) {
      const found = userIngredients.some(
        (ui) => ri.includes(ui) || ui.includes(ri),
      );
      if (found) {
        matched++;
        matchedNames.push(ri);
      }
    }

    if (matched === 0) return null;

    const matchPercent = Math.round((matched / recipeNames.length) * 100);

    return {
      ...recipe,
      match_percent:    matchPercent,
      matched_count:    matched,
      total_count:      recipeNames.length,
      matched_ingredients: matchedNames,
    };
  });

  return scored
    .filter(Boolean)
    .sort((a: any, b: any) => b.match_percent - a.match_percent)
    .slice(0, 15);
}

export async function unsaveRecipe(userId: string, recipeId: string) {
  const { error } = await supabaseAdmin
    .from('saved_recipes')
    .delete()
    .eq('user_id', userId)
    .eq('recipe_id', recipeId);

  if (error) throw new AppError(500, error.message);
}
