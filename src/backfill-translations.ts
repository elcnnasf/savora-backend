// One-off/maintenance script: add a missing translation language to every recipe.
// Idempotent — only touches recipes that don't have the language yet.
// Usage: npx tsx src/backfill-translations.ts [lang]   (default: az)
import { supabaseAdmin } from './config/supabase';
import { ensureRecipeTranslation } from './services/aiService';

(async () => {
  const lang = process.argv[2] || 'az';
  const { data, error } = await supabaseAdmin.from('recipes').select('*');
  if (error) { console.error(error.message); process.exit(1); }

  const missing = (data ?? []).filter((r: any) => !r.translations?.[lang]);
  console.log(`${missing.length} recipes missing "${lang}" translation`);

  let ok = 0, fail = 0;
  for (const r of missing) {
    try {
      const updated = await ensureRecipeTranslation(r, lang);
      const got = !!updated.translations?.[lang];
      console.log(got ? 'OK  ' : 'SKIP', r.title.slice(0, 50));
      got ? ok++ : fail++;
    } catch (e: any) {
      console.log('ERR ', r.title.slice(0, 50), '-', e.message?.slice(0, 80));
      fail++;
    }
    // stay under the light-tier free-tier requests-per-minute limit
    await new Promise((res) => setTimeout(res, 3000));
  }
  console.log(`done: ${ok} translated, ${fail} skipped/failed`);
  process.exit(0);
})();
