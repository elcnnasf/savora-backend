// Maintenance script: make sure every recipe has a translated TITLE in every
// supported language (title-only stubs) so lists and search work in all
// languages. Bodies are translated lazily on first view. Idempotent.
// Usage: npx tsx src/backfill-titles.ts
import { supabaseAdmin } from './config/supabase';
import { aiComplete } from './services/aiService';

const LANGS: Record<string, string> = { az: 'Azerbaijani', ru: 'Russian', tr: 'Turkish' };
const BATCH = 40;

(async () => {
  const { data, error } = await supabaseAdmin.from('recipes').select('id, title, translations');
  if (error) { console.error(error.message); process.exit(1); }
  const recipes: any[] = data ?? [];

  for (const [lang, name] of Object.entries(LANGS)) {
    const missing = recipes.filter((r) => !r.translations?.[lang]?.title);
    if (missing.length === 0) { console.log(`${lang}: all titles present`); continue; }
    console.log(`${lang}: translating ${missing.length} titles`);

    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const list = batch.map((r, idx) => `${idx}: ${r.translations?.en?.title ?? r.title}`).join('\n');

      let raw: string;
      try {
        raw = await aiComplete('light', {
          messages: [
            {
              role: 'system',
              content: `Translate dish names into natural, native-quality ${name} culinary language. Keep proper local dish names recognizable (e.g. "Piti (Azerbaijani Clay Pot Soup)" keeps "Piti"). Return valid JSON only: {"titles":{"0":"...","1":"..."}} — same numeric keys as the input.`,
            },
            { role: 'user', content: list },
          ],
          temperature: 0.2,
          max_tokens: 3000,
          response_format: { type: 'json_object' },
        } as any);
      } catch (e: any) {
        console.log(`ERR  ${lang} batch ${i / BATCH} - ${e.message?.slice(0, 80)}`);
        continue;
      }

      let titles: any;
      try { titles = JSON.parse(raw).titles ?? JSON.parse(raw); } catch { console.log(`ERR  ${lang} batch ${i / BATCH} - invalid JSON`); continue; }

      for (let j = 0; j < batch.length; j++) {
        const t = titles[String(j)];
        if (!t || typeof t !== 'string') continue;
        const r = batch[j];
        const merged = { ...(r.translations ?? {}), [lang]: { ...(r.translations?.[lang] ?? {}), title: t } };
        const { error: upErr } = await supabaseAdmin.from('recipes').update({ translations: merged }).eq('id', r.id);
        if (upErr) { console.log('ERR ', r.id, upErr.message.slice(0, 60)); continue; }
        r.translations = merged; // keep local copy fresh so later languages don't clobber this one
        console.log('OK  ', lang, '|', t.slice(0, 55));
      }
      await new Promise((res) => setTimeout(res, 3000)); // light-tier RPM headroom
    }
  }
  console.log('done');
  process.exit(0);
})();
