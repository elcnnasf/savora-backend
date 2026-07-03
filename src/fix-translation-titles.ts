import * as fs from 'fs';
import * as path from 'path';
import { supabaseAdmin } from './config/supabase';
import { groq, GROQ_MODEL } from './config/groq';

/**
 * Repairs machine-translated recipe titles (az/ru/tr) for recipes that were
 * auto-translated by translate-missing-recipes.ts. The curated recipes from
 * src/data/recipe-translations.part*.json are left untouched.
 *
 * Usage: npx tsx src/fix-translation-titles.ts
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function curatedTitles(): Set<string> {
  const dir = path.join(__dirname, 'data');
  const titles = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    if (!/^recipe-translations\.part.*\.json$/.test(f)) continue;
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const r of arr) titles.add(r.title);
  }
  return titles;
}

interface TitleFix { id: string; az: string; ru: string; tr: string }

async function fixBatch(batch: { id: string; en: string; az: string; ru: string; tr: string }[]): Promise<TitleFix[]> {
  const list = batch
    .map((b, i) => `${i + 1}. EN: "${b.en}" | az: "${b.az}" | ru: "${b.ru}" | tr: "${b.tr}"`)
    .join('\n');

  const prompt = `Below are recipe titles with machine translations into Azerbaijani (az), Russian (ru) and Turkish (tr). Some translations are wrong or unnatural.

For EACH item return the CORRECT, natural dish title in all three languages. If a translation is already correct, return it unchanged. Titles must sound like real dish names a native speaker would use.

Glossary: salmon=qızılbalıq/лосось/somon, lamb=quzu əti, beef=mal əti, stew=qovurma/buğlama, meatball=küftə, chickpea=noxud, lentil=mərci, noodle=əriştə, buckwheat=qarabaşaq, walnut=qoz, stuffed=doldurulmuş, grilled=qril edilmiş / manqalda.

ITEMS:
${list}

Return ONLY JSON:
{"items":[{"n":1,"az":"...","ru":"...","tr":"..."},{"n":2,...}]}`;

  const res = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: 'You are a professional culinary translator (Azerbaijani, Russian, Turkish native level). Return valid JSON only.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  } as any);

  const parsed = JSON.parse((res as any).choices[0].message.content ?? '{}');
  const items: any[] = parsed.items ?? [];
  const fixes: TitleFix[] = [];
  for (const it of items) {
    const src = batch[Number(it.n) - 1];
    if (!src) continue;
    if (typeof it.az === 'string' && it.az.trim() && typeof it.ru === 'string' && typeof it.tr === 'string') {
      fixes.push({ id: src.id, az: it.az.trim(), ru: it.ru.trim(), tr: it.tr.trim() });
    }
  }
  return fixes;
}

async function main() {
  const curated = curatedTitles();

  const { data: recipes, error } = await supabaseAdmin
    .from('recipes')
    .select('id, title, translations')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const targets = (recipes ?? []).filter(
    (r: any) => r.translations?.az?.title && !curated.has(r.title),
  );
  console.log(`Recipes with auto-translated titles to review: ${targets.length}`);

  const batchSize = 12;
  let fixedCount = 0;

  for (let i = 0; i < targets.length; i += batchSize) {
    const slice = targets.slice(i, i + batchSize).map((r: any) => ({
      id: r.id,
      en: r.translations?.en?.title ?? r.title,
      az: r.translations.az.title,
      ru: r.translations?.ru?.title ?? '',
      tr: r.translations?.tr?.title ?? '',
    }));

    try {
      const fixes = await fixBatch(slice);
      for (const fix of fixes) {
        const recipe: any = targets.find((r: any) => r.id === fix.id);
        const t = recipe.translations;
        const changed =
          t.az.title !== fix.az ||
          (t.ru && t.ru.title !== fix.ru) ||
          (t.tr && t.tr.title !== fix.tr);
        if (!changed) continue;

        const before = t.az.title;
        t.az.title = fix.az;
        if (t.ru) t.ru.title = fix.ru;
        if (t.tr) t.tr.title = fix.tr;

        const { error: upErr } = await supabaseAdmin
          .from('recipes')
          .update({ translations: t })
          .eq('id', fix.id);
        if (upErr) { console.log(`FAIL  ${recipe.title} — ${upErr.message}`); continue; }
        fixedCount++;
        console.log(`FIXED ${recipe.title}: "${before}" → "${fix.az}"`);
      }
    } catch (err: any) {
      console.log(`BATCH FAIL [${i}-${i + batchSize}]: ${err.message}`);
    }

    await sleep(5000);
  }

  console.log(`\nDone. Titles fixed: ${fixedCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
