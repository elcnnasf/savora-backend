import { supabaseAdmin } from './config/supabase';
import { groq, GROQ_MODEL, GROQ_FALLBACK_MODEL } from './config/groq';

/**
 * Generates az/ru/tr translations for every recipe whose `translations`
 * column is missing them, using the recipe's English content as the base.
 * Safe to re-run: already-translated recipes are skipped.
 *
 * Usage: npx tsx src/translate-missing-recipes.ts
 */

interface LangContent {
  title: string;
  description?: string;
  ingredients: { name: string; amount: string }[];
  steps: { step: number; instruction: string; duration?: string | number | null }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function complete(prompt: string): Promise<string> {
  const params = {
    messages: [
      {
        role: 'system' as const,
        content:
          'You are a professional culinary translator for Azerbaijani, Russian and Turkish. ' +
          'Translate naturally using proper culinary terminology. Keep amounts/quantities unchanged. ' +
          'Return valid JSON only, no markdown, no extra text.',
      },
      { role: 'user' as const, content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: 'json_object' as const },
  };
  try {
    const res = await groq.chat.completions.create({ ...params, model: GROQ_MODEL });
    return (res as any).choices[0].message.content ?? '{}';
  } catch (err: any) {
    const status = err?.status ?? err?.error?.status;
    if (status === 429) {
      // rate limited — wait and retry once on the fallback model
      await sleep(15000);
      const res = await groq.chat.completions.create({ ...params, model: GROQ_FALLBACK_MODEL, max_tokens: 3000 });
      return (res as any).choices[0].message.content ?? '{}';
    }
    throw err;
  }
}

function buildPrompt(en: LangContent): string {
  return `Translate this recipe from English into Azerbaijani (az), Russian (ru) and Turkish (tr).

RECIPE (English):
${JSON.stringify(en, null, 2)}

Rules:
- Translate title, description, ingredient names and step instructions.
- Keep ingredient "amount" values as-is (units may be translated: cup→stəkan/стакан/su bardağı, tbsp→x.q./ст.л./yk etc., but numbers unchanged).
- Keep "step" numbers and "duration" values unchanged.
- Same array lengths as the English version.

Return JSON with EXACTLY this structure:
{
  "az": { "title": "...", "description": "...", "ingredients": [{"name":"...","amount":"..."}], "steps": [{"step":1,"instruction":"...","duration":...}] },
  "ru": { "title": "...", "description": "...", "ingredients": [...], "steps": [...] },
  "tr": { "title": "...", "description": "...", "ingredients": [...], "steps": [...] }
}`;
}

function isValidLang(c: any, en: LangContent): boolean {
  return (
    c &&
    typeof c.title === 'string' && c.title.trim().length > 0 &&
    Array.isArray(c.ingredients) && c.ingredients.length === en.ingredients.length &&
    Array.isArray(c.steps) && c.steps.length === en.steps.length
  );
}

async function main() {
  const { data: recipes, error } = await supabaseAdmin
    .from('recipes')
    .select('id, title, description, ingredients, steps, translations')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const missing = (recipes ?? []).filter((r: any) => !(r.translations && r.translations.az && r.translations.az.title));
  console.log(`Recipes total: ${recipes?.length}, missing az translation: ${missing.length}`);

  let ok = 0;
  let fail = 0;
  const failed: string[] = [];

  for (const [i, r] of missing.entries()) {
    const en: LangContent = {
      title: r.title,
      description: r.description ?? '',
      ingredients: r.ingredients ?? [],
      steps: r.steps ?? [],
    };

    if (en.ingredients.length === 0 && en.steps.length === 0) {
      console.log(`SKIP  [${i + 1}/${missing.length}] ${r.title} — no ingredients/steps`);
      continue;
    }

    try {
      const raw = await complete(buildPrompt(en));
      const parsed = JSON.parse(raw);

      if (!isValidLang(parsed.az, en) || !isValidLang(parsed.ru, en) || !isValidLang(parsed.tr, en)) {
        throw new Error('translation validation failed (missing fields or length mismatch)');
      }

      const translations = {
        ...(r.translations ?? {}),
        en,
        az: parsed.az,
        ru: parsed.ru,
        tr: parsed.tr,
      };

      const { error: upErr } = await supabaseAdmin
        .from('recipes')
        .update({ translations })
        .eq('id', r.id);
      if (upErr) throw new Error(upErr.message);

      ok++;
      console.log(`OK    [${i + 1}/${missing.length}] ${r.title} — az: ${parsed.az.title}`);
    } catch (err: any) {
      fail++;
      failed.push(r.title);
      console.log(`FAIL  [${i + 1}/${missing.length}] ${r.title} — ${err.message}`);
    }

    await sleep(1500); // stay under Groq rate limits
  }

  console.log('\n==== SUMMARY ====');
  console.log(`Updated OK: ${ok}`);
  console.log(`Failed:     ${fail}`);
  if (failed.length) failed.forEach((t) => console.log(`  - ${t}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
