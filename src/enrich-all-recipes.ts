import dotenv from 'dotenv';
dotenv.config();

import { supabaseAdmin } from './config/supabase';
import { groq, GROQ_MODEL } from './config/groq';

const DELAY_MS = 2200; // ~27 req/min — safe under Groq 30 req/min limit
const RETRY_DELAY_MS = 8000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function enrichRecipe(recipe: {
  id: string;
  title: string;
  cuisine: string | null;
  difficulty: string | null;
  cook_time: number;
  prep_time: number;
  servings: number;
  calories: number | null;
}): Promise<any | null> {
  const prompt = `You are a professional chef AI. Generate complete, detailed recipe content for "${recipe.title}".

RECIPE CONTEXT:
- Cuisine: ${recipe.cuisine || 'Azerbaijani/International'}
- Difficulty: ${recipe.difficulty || 'medium'}
- Cook time: ${recipe.cook_time} minutes
- Prep time: ${recipe.prep_time || 10} minutes
- Servings: ${recipe.servings || 2}
- Calories: ${recipe.calories || 'estimate appropriately'}

REQUIREMENTS:
- At least 6-8 detailed cooking steps, each 2-3 sentences with temperature, timing, and visual cues
- 6-12 realistic ingredients with precise amounts
- Appetizing 2-3 sentence description per language
- Accurate translations — do NOT just transliterate, use proper culinary terms in each language

Return ONLY valid JSON with this exact structure:
{
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "translations": {
    "en": {
      "title": "Proper English culinary name",
      "description": "2-3 sentence appetizing description",
      "ingredients": [{"name": "ingredient", "amount": "precise quantity with unit"}],
      "steps": [{"step": 1, "instruction": "Detailed 2-3 sentence instruction with technique and visual cues.", "duration": number_or_null}]
    },
    "az": {
      "title": "Düzgün Azərbaycanca kulinar adı",
      "description": "2-3 cümləlik iştahaaçan təsvir",
      "ingredients": [{"name": "inqrediyent adı", "amount": "dəqiq miqdar"}],
      "steps": [{"step": 1, "instruction": "Ətraflı 2-3 cümləlik addım.", "duration": same_number_as_en}]
    },
    "ru": {
      "title": "Правильное кулинарное название",
      "description": "2-3 предложения описания",
      "ingredients": [{"name": "название ингредиента", "amount": "точное количество"}],
      "steps": [{"step": 1, "instruction": "Подробный шаг 2-3 предложения.", "duration": same_number_as_en}]
    },
    "tr": {
      "title": "Türkçe mutfak adı",
      "description": "2-3 cümlelik lezzetli açıklama",
      "ingredients": [{"name": "malzeme adı", "amount": "kesin miktar"}],
      "steps": [{"step": 1, "instruction": "Türkçe detaylı 2-3 cümlelik adım.", "duration": same_number_as_en}]
    }
  }
}`;

  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You are a professional chef AI. Always respond with valid JSON only, no markdown, no extra text.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content ?? '{}';
    return JSON.parse(raw);
  } catch (err: any) {
    if (err?.status === 429) {
      console.log('    Rate limit hit — waiting 30s...');
      await sleep(30000);
      return null; // will retry
    }
    console.log(`    Groq error: ${err.message}`);
    return null;
  }
}

async function main() {
  // Check translations column exists
  const probe = await supabaseAdmin.from('recipes').select('translations').limit(1);
  if (probe.error) {
    console.error('\nThe `translations` column does not exist!');
    console.error('Run this in Supabase SQL Editor first:');
    console.error('  ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS translations JSONB;');
    process.exit(1);
  }

  // Fetch all recipes
  const { data: recipes, error } = await supabaseAdmin
    .from('recipes')
    .select('id, title, cuisine, difficulty, cook_time, prep_time, servings, calories, translations')
    .order('title');

  if (error || !recipes) {
    console.error('Failed to fetch recipes:', error?.message);
    process.exit(1);
  }

  // Filter: skip recipes that already have translations with all 4 languages
  const toProcess = recipes.filter((r: any) => {
    const t = r.translations;
    return !t || !t.en || !t.az || !t.ru || !t.tr;
  });

  console.log(`\nTotal recipes in DB: ${recipes.length}`);
  console.log(`Already enriched:    ${recipes.length - toProcess.length}`);
  console.log(`To process:          ${toProcess.length}`);
  console.log(`Estimated time:      ~${Math.ceil(toProcess.length * DELAY_MS / 60000)} minutes\n`);

  if (toProcess.length === 0) {
    console.log('All recipes already have translations!');
    return;
  }

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const recipe = toProcess[i];
    process.stdout.write(`[${i + 1}/${toProcess.length}] "${recipe.title}" → `);

    let parsed = await enrichRecipe(recipe);

    // One retry on failure
    if (!parsed) {
      process.stdout.write('retrying... ');
      await sleep(RETRY_DELAY_MS);
      parsed = await enrichRecipe(recipe);
    }

    if (!parsed || !parsed.translations?.en) {
      console.log('FAIL');
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    const en = parsed.translations.en;

    const updatePayload: Record<string, any> = {
      translations: parsed.translations,
      description: en.description,
      ingredients: en.ingredients,
      steps: en.steps,
    };

    // Update nutrition if AI returned estimates and DB has no values
    if (!recipe.calories && parsed.calories) updatePayload.calories = parsed.calories;
    if (parsed.protein) updatePayload.protein = parsed.protein;
    if (parsed.carbs)   updatePayload.carbs   = parsed.carbs;
    if (parsed.fat)     updatePayload.fat     = parsed.fat;

    const { error: updateErr } = await supabaseAdmin
      .from('recipes')
      .update(updatePayload)
      .eq('id', recipe.id);

    if (updateErr) {
      console.log(`FAIL (${updateErr.message})`);
      failed++;
    } else {
      console.log('OK');
      ok++;
    }

    await sleep(DELAY_MS);
  }

  console.log('\n==== SUMMARY ====');
  console.log(`Processed: ${toProcess.length}`);
  console.log(`Success:   ${ok}`);
  console.log(`Failed:    ${failed}`);

  if (failed > 0) {
    console.log('\nTip: Run the script again — failed recipes will be retried automatically.');
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
