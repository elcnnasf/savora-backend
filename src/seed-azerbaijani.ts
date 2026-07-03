/**
 * Seed script: inserts 100 Azerbaijani recipes into Supabase.
 * Run once from the backend directory:
 *   npx ts-node src/seed-azerbaijani.ts
 */

import { supabaseAdmin } from './config/supabase';
import { azerbaijaniRecipes1 } from './data/azerbaijaniRecipes_part1';
import { azerbaijaniRecipes2 } from './data/azerbaijaniRecipes_part2';

const ALL_RECIPES = [...azerbaijaniRecipes1, ...azerbaijaniRecipes2];

async function seed() {
  console.log(`\nSeeding ${ALL_RECIPES.length} Azerbaijani recipes...`);

  let inserted = 0;
  let skipped  = 0;
  let failed   = 0;

  for (const recipe of ALL_RECIPES) {
    // Check if a recipe with this title already exists (avoid duplicates)
    const { data: existing } = await supabaseAdmin
      .from('recipes')
      .select('id')
      .eq('title', recipe.title)
      .maybeSingle();

    if (existing) {
      console.log(`  SKIP  "${recipe.title}" (already exists)`);
      skipped++;
      continue;
    }

    const { error } = await supabaseAdmin.from('recipes').insert({
      title:           recipe.title,
      description:     recipe.description,
      image_url:       recipe.image_url,
      calories:        recipe.calories,
      protein:         recipe.protein,
      carbs:           recipe.carbs,
      fat:             recipe.fat,
      cook_time:       recipe.cook_time,
      prep_time:       recipe.prep_time,
      servings:        recipe.servings,
      difficulty:      recipe.difficulty,
      cuisine:         recipe.cuisine,
      tags:            recipe.tags,
      ingredients:     recipe.ingredients,
      steps:           recipe.steps,
      translations:    recipe.translations,
      is_ai_generated: false,
    });

    if (error) {
      console.error(`  FAIL  "${recipe.title}":`, error.message);
      failed++;
    } else {
      console.log(`  OK    "${recipe.title}"`);
      inserted++;
    }
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped, ${failed} failed.\n`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
