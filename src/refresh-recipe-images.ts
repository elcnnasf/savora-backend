// Refresh every recipe's image using the new source chain:
//   1. Wikipedia (strict title match) → re-hosted in Supabase Storage
//   2. Pexels with an AI-generated visual description (batch via Gemini Flash-Lite)
//   3. Pexels with the dish title
//   4. keep the existing image (never downgrade)
// Run: npx tsx src/refresh-recipe-images.ts

import { supabaseAdmin } from './config/supabase';
import {
  aiComplete,
  fetchWikipediaImage,
  fetchPexelsImage,
  rehostImage,
  RECIPE_IMAGES_BUCKET,
} from './services/aiService';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureBucket() {
  const { error } = await supabaseAdmin.storage.createBucket(RECIPE_IMAGES_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) throw error;
}

// One Flash-Lite call per batch: dish titles in → visual stock-photo queries out
async function generateVisualQueries(
  recipes: { id: string; title: string; cuisine: string | null }[],
): Promise<Record<string, string>> {
  const list = recipes.map((r) => `${r.id}: ${r.title}${r.cuisine ? ` (${r.cuisine})` : ''}`).join('\n');
  try {
    // aiComplete = Gemini Flash-Lite with automatic Groq fallback (Gemini free tier 503s often)
    const raw = await aiComplete('light', {
      messages: [
        {
          role: 'system',
          content:
            'For each dish, write a 4-7 word English stock-photo search query describing how the FINISHED dish looks: main visible ingredients + dish type + serving vessel. NEVER use local/proper dish names or nationality words — stock photo sites do not know them. Return ONLY a JSON object mapping each id to its query.',
        },
        { role: 'user', content: list },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    } as any);
    return JSON.parse(raw);
  } catch (e: any) {
    console.warn(`  visual query batch failed (${e.message}) — will fall back to titles`);
    return {};
  }
}

async function main() {
  await ensureBucket();

  const { data: recipes, error } = await supabaseAdmin
    .from('recipes')
    .select('id, title, cuisine, image_url')
    .order('created_at', { ascending: true });
  if (error) throw error;
  console.log(`recipes: ${recipes.length}`);

  // Batch-generate visual queries (25 per call ≈ 6 Flash-Lite requests)
  const visualQueries: Record<string, string> = {};
  for (let i = 0; i < recipes.length; i += 25) {
    const batch = recipes.slice(i, i + 25);
    Object.assign(visualQueries, await generateVisualQueries(batch));
    console.log(`visual queries: ${Math.min(i + 25, recipes.length)}/${recipes.length}`);
    await sleep(1000);
  }

  let wiki = 0, pexelsQ = 0, pexelsT = 0, kept = 0, failedRehost = 0;

  for (const [i, r] of recipes.entries()) {
    let newUrl: string | null = null;
    let source = '';

    const wikiUrl = await fetchWikipediaImage(r.title);
    if (wikiUrl) {
      newUrl = await rehostImage(wikiUrl);
      if (newUrl) { source = 'wikipedia'; wiki++; }
      else failedRehost++;
    }

    if (!newUrl && visualQueries[r.id]) {
      newUrl = await fetchPexelsImage(visualQueries[r.id]);
      if (newUrl) { source = 'pexels(visual)'; pexelsQ++; }
    }

    if (!newUrl) {
      newUrl = await fetchPexelsImage(`${r.title.split('(')[0].trim()} food dish`);
      if (newUrl) { source = 'pexels(title)'; pexelsT++; }
    }

    if (newUrl && newUrl !== r.image_url) {
      const { error: updErr } = await supabaseAdmin
        .from('recipes')
        .update({ image_url: newUrl })
        .eq('id', r.id);
      if (updErr) console.warn(`  UPDATE FAILED ${r.title}: ${updErr.message}`);
    } else if (!newUrl) {
      source = 'kept existing';
      kept++;
    }

    console.log(`[${i + 1}/${recipes.length}] ${r.title} → ${source}`);
    await sleep(400); // stay under Wikipedia + Pexels rate limits
  }

  console.log(`\nDone. wikipedia: ${wiki}, pexels(visual): ${pexelsQ}, pexels(title): ${pexelsT}, kept: ${kept}, wiki rehost failures: ${failedRehost}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
