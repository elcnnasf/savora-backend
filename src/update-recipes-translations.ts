import { supabaseAdmin } from './config/supabase';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Updates every Azerbaijani recipe with multilingual content (en, az, ru, tr).
 *
 * Recipe data lives in src/data/recipe-translations.part*.json so the large
 * payload stays out of the TypeScript source and is easy to maintain. Each part
 * is a JSON array of objects:
 *   { "title": "<exact DB title>", "translations": { en, az, ru, tr } }
 * where each language has { title, description, ingredients[], steps[] }.
 *
 * For each recipe we update:
 *   - translations  (full 4-language object)
 *   - description    (improved English copy)
 *   - ingredients    (English ingredients)
 *   - steps          (improved English steps with timing/visual cues)
 * matched by the exact `title`.
 */

interface LangContent {
  title: string;
  description: string;
  ingredients: { name: string; amount: string }[];
  steps: { step: number; instruction: string; duration: number }[];
}
interface RecipeEntry {
  title: string;
  translations: { en: LangContent; az: LangContent; ru: LangContent; tr: LangContent };
}

function loadRecipes(): RecipeEntry[] {
  const dir = path.join(__dirname, 'data');
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^recipe-translations\.part.*\.json$/.test(f))
    .sort();
  const all: RecipeEntry[] = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RecipeEntry[];
    all.push(...arr);
  }
  return all;
}

async function columnExists(): Promise<boolean> {
  const probe = await supabaseAdmin.from('recipes').select('translations').limit(1);
  return !probe.error;
}

async function main() {
  const recipes = loadRecipes();
  console.log(`Loaded ${recipes.length} recipe definitions from src/data/`);

  // Guard against duplicate titles within our data set.
  const titles = new Set<string>();
  for (const r of recipes) {
    if (titles.has(r.title)) console.warn(`  ! duplicate title in data: ${r.title}`);
    titles.add(r.title);
  }

  if (!(await columnExists())) {
    console.error('\nThe `translations` column does not exist yet.');
    console.error('Run migration.sql in the Supabase SQL Editor, then re-run this script:');
    console.error('  ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS translations JSONB;');
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  const failed: string[] = [];

  for (const r of recipes) {
    const en = r.translations.en;
    const { data, error } = await supabaseAdmin
      .from('recipes')
      .update({
        translations: r.translations,
        description: en.description,
        ingredients: en.ingredients,
        steps: en.steps,
      })
      .eq('title', r.title)
      .select('id');

    if (error) {
      fail++;
      failed.push(`${r.title} — ${error.message}`);
      console.log(`FAIL  ${r.title} — ${error.message}`);
    } else if (!data || data.length === 0) {
      fail++;
      failed.push(`${r.title} — no matching row`);
      console.log(`FAIL  ${r.title} — no matching row in DB`);
    } else {
      ok++;
      console.log(`OK    ${r.title}`);
    }
  }

  console.log('\n==== SUMMARY ====');
  console.log(`Total definitions: ${recipes.length}`);
  console.log(`Updated OK:        ${ok}`);
  console.log(`Failed:            ${fail}`);
  if (failed.length) {
    console.log('Failures:');
    for (const f of failed) console.log(`  - ${f}`);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
