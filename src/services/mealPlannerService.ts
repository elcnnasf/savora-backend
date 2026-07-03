import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { AddMealItemInput } from '../schemas/mealPlanner';

async function getOrCreatePlan(userId: string, weekStart: string) {
  // Try to get existing plan
  const { data: existing } = await supabaseAdmin
    .from('meal_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .single();

  if (existing) return existing.id as string;

  // Create new plan for this week
  const { data, error } = await supabaseAdmin
    .from('meal_plans')
    .insert({ user_id: userId, week_start: weekStart })
    .select('id')
    .single();

  if (error) throw new AppError(500, error.message);
  return data.id as string;
}

export async function getWeekPlan(userId: string, weekStart: string) {
  const { data: plan } = await supabaseAdmin
    .from('meal_plans')
    .select('id, week_start, created_at')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .single();

  if (!plan) {
    return {
      week_start: weekStart,
      items: [],
      total_calories: 0,
      by_day: buildEmptyWeek(),
    };
  }

  const { data: items, error } = await supabaseAdmin
    .from('meal_plan_items')
    .select('*, recipes(title, image_url, calories, cook_time, difficulty)')
    .eq('meal_plan_id', plan.id)
    .order('day_of_week', { ascending: true })
    .order('meal_type', { ascending: true });

  if (error) throw new AppError(500, error.message);

  const allItems = items ?? [];
  const totalCalories = allItems.reduce((sum: number, i: any) => sum + (i.calories ?? 0), 0);

  // Group by day
  const byDay = buildEmptyWeek();
  for (const item of allItems) {
    byDay[item.day_of_week].push(item);
  }

  return {
    plan_id: plan.id,
    week_start: weekStart,
    total_calories: totalCalories,
    items: allItems,
    by_day: byDay,
  };
}

export async function addMealItem(userId: string, weekStart: string, input: AddMealItemInput) {
  const planId = await getOrCreatePlan(userId, weekStart);

  // Prevent duplicate meal_type on same day
  const { data: existing } = await supabaseAdmin
    .from('meal_plan_items')
    .select('id')
    .eq('meal_plan_id', planId)
    .eq('day_of_week', input.day_of_week)
    .eq('meal_type', input.meal_type)
    .single();

  if (existing) {
    // Update instead of creating duplicate
    const { data, error } = await supabaseAdmin
      .from('meal_plan_items')
      .update({
        recipe_id:    input.recipe_id ?? null,
        recipe_title: input.recipe_title,
        calories:     input.calories ?? null,
        notes:        input.notes ?? null,
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new AppError(500, error.message);
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from('meal_plan_items')
    .insert({ ...input, meal_plan_id: planId })
    .select()
    .single();

  if (error) throw new AppError(500, error.message);
  return data;
}

export async function deleteMealItem(userId: string, itemId: string) {
  // Verify ownership via plan
  const { data: item } = await supabaseAdmin
    .from('meal_plan_items')
    .select('meal_plan_id, meal_plans(user_id)')
    .eq('id', itemId)
    .single();

  if (!item) throw new AppError(404, 'Meal item not found');

  const plan = (item as any).meal_plans;
  if (plan?.user_id !== userId) throw new AppError(403, 'Forbidden');

  const { error } = await supabaseAdmin
    .from('meal_plan_items')
    .delete()
    .eq('id', itemId);

  if (error) throw new AppError(500, error.message);
}

export async function clearDayMeals(userId: string, weekStart: string, dayOfWeek: number) {
  const { data: plan } = await supabaseAdmin
    .from('meal_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .single();

  if (!plan) return;

  await supabaseAdmin
    .from('meal_plan_items')
    .delete()
    .eq('meal_plan_id', plan.id)
    .eq('day_of_week', dayOfWeek);
}

function buildEmptyWeek(): Record<number, any[]> {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}
