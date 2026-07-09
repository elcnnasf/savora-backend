import { groq, GROQ_MODEL, GROQ_FALLBACK_MODEL } from '../config/groq';
import {
  geminiComplete,
  geminiVision,
  GEMINI_HEAVY_MODEL,
  GEMINI_LIGHT_MODEL,
} from '../config/gemini';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { GenerateRecipeInput } from '../schemas/recipe';
import { ChatInput, MealPlanInput, SuggestRecipesInput, AnalyzeCaloriesInput } from '../schemas/ai';
import { createRecipe, updateRecipeTranslations } from './recipeService';
import { env } from '../config/env';
import Jimp from 'jimp';

async function groqComplete(params: Parameters<typeof groq.chat.completions.create>[0]): Promise<string> {
  try {
    const res = await groq.chat.completions.create({ ...params, model: GROQ_MODEL, stream: false });
    return res.choices[0].message.content ?? '{}';
  } catch (err: any) {
    const status = err?.status ?? err?.error?.status;
    const msg = err?.message ?? '';
    const isRateLimit = status === 429 || msg.includes('rate_limit') || msg.includes('Rate limit');
    const isTooLarge  = status === 413 || msg.includes('too large') || msg.includes('Request too large');

    if (isRateLimit || isTooLarge) {
      // Fallback model has 6000 TPM — cap max_tokens so input+output stays under limit
      const fallbackParams = {
        ...params,
        model: GROQ_FALLBACK_MODEL,
        max_tokens: Math.min((params as any).max_tokens ?? 2000, 3000),
      };
      try {
        const res = await groq.chat.completions.create({ ...fallbackParams, stream: false });
        return res.choices[0].message.content ?? '{}';
      } catch (fb: any) {
        throw new AppError(503, `AI service error (fallback): ${fb.message}`);
      }
    }
    throw new AppError(503, `AI service error: ${err.message}`);
  }
}

// ─── Smart AI routing: Gemini primary, Groq fallback ────────────────────────
// heavy (recipe, meal plan) → Gemini 2.5 Flash | light (chat, suggestions, research) → Flash-Lite
// Any Gemini failure (rate limit, missing key, API error) falls back to Groq.
type AiTier = 'heavy' | 'light';
const GEMINI_MODEL_FOR: Record<AiTier, string> = {
  heavy: GEMINI_HEAVY_MODEL,
  light: GEMINI_LIGHT_MODEL,
};

export async function aiComplete(
  tier: AiTier,
  params: Parameters<typeof groq.chat.completions.create>[0],
): Promise<string> {
  const p = params as any;
  if (env.gemini.apiKey) {
    try {
      return await geminiComplete({
        model: GEMINI_MODEL_FOR[tier],
        messages: p.messages,
        temperature: p.temperature,
        maxTokens: p.max_tokens,
        json: p.response_format?.type === 'json_object',
      });
    } catch (err: any) {
      console.warn(`[ai] Gemini ${tier} failed (${err.message}) — falling back to Groq`);
    }
  }
  return groqComplete(params);
}

type UsageField = 'recipes_count' | 'scans_count' | 'ai_chat_count' | 'suggestions_count' | 'meal_plans_count' | 'calories_count';

// Cost estimate per request (Groq paid tier):
//   recipe: ~4000 tok → ~$0.004 | suggestion: ~2500 tok → $0.002 | chat: ~500 tok → $0.0004
// Pro max daily cost: 25×$0.004 + 30×$0.002 + 100×$0.0004 = $0.10+$0.06+$0.04 = $0.20/day → $6/month
// Pro revenue: 12.99 AZN ≈ $7.65/month → margin ~$1.65/user (safe, avg user won't hit max)
// Premium max daily cost: 10×$0.004 + 15×$0.002 + 50×$0.0004 = $0.04+$0.03+$0.02 = $0.09/day → $2.7/month
// Premium revenue: 3.99 AZN ≈ $2.35/month → covers infra on avg usage
const DAILY_LIMITS: Record<UsageField, { free: number; premium: number; pro: number }> = {
  recipes_count:     { free: 3,  premium: 10, pro: 25 },
  suggestions_count: { free: 5,  premium: 15, pro: 30 },
  scans_count:       { free: 3,  premium: 10, pro: 20 },
  ai_chat_count:     { free: 10, premium: 50, pro: 100 },
  meal_plans_count:  { free: 1,  premium: 3,  pro: 5  },
  // Premium/Pro-only feature (free users are rejected before the quota check)
  calories_count:    { free: 0,  premium: 15, pro: 40 },
};

// Keyword-to-photo mapping for accurate food images
const FOOD_IMAGE_MAP: { keywords: string[]; photos: string[] }[] = [
  {
    keywords: ['pasta', 'spaghetti', 'noodle', 'fettuccine', 'penne', 'linguine', 'ravioli', 'lasagna', 'rigatoni', 'tagliatelle', 'macaroni'],
    photos: ['1621996346565-e3dbc646d9a9', '1555396273-367ea4eb4db5', '1546549032-9571cd6b27df'],
  },
  {
    keywords: ['pizza'],
    photos: ['1565299624946-b28f40a0ae38', '1513104890138-7c749659a591', '1571997478133-b82cb9f4d8a9'],
  },
  {
    keywords: ['soup', 'stew', 'chowder', 'broth', 'bisque', 'chili', 'ramen', 'pho', 'minestrone', 'goulash', 'shorba'],
    photos: ['1547592166-23ac45744acd', '1604152135912-04a022e23696', '1571834124613-e7fb6ba0d258'],
  },
  {
    keywords: ['salad', 'slaw', 'coleslaw'],
    photos: ['1512621776951-a57141f2eefd', '1540189549336-e6e99c3679fe', '1488459716781-31db52582fe9'],
  },
  {
    keywords: ['rice', 'pilaf', 'risotto', 'fried rice', 'biryani', 'paella', 'pilav'],
    photos: ['1534422298391-e4f8c172dddb', '1603133872878-684f208fb84b', '1569050467447-ce54b3bbc37d'],
  },
  {
    keywords: ['chicken', 'poultry', 'hen', 'toyuq'],
    photos: ['1598103442097-8b74394b95c3', '1604908176997-125f25cc6f3d', '1432139555190-58524dae6a55'],
  },
  {
    keywords: ['beef', 'steak', 'meatball', 'meatloaf', 'ground beef', 'brisket', 'dana', 'kotlet'],
    photos: ['1546833999-b9f581a1996d', '1601050690597-df0568f70950', '1529693662653-9d480da3af58'],
  },
  {
    keywords: ['burger', 'hamburger', 'slider'],
    photos: ['1568901346375-23c9450c58cd', '1550547660-d9450f859349', '1529042410759-befb1204b468'],
  },
  {
    keywords: ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout', 'sea bass', 'baliq'],
    photos: ['1614975059251-992f11792b9f', '1519708227418-c8fd9a32b7a2', '1535140728325-a4d3707eee61'],
  },
  {
    keywords: ['shrimp', 'prawn', 'seafood', 'lobster', 'crab', 'scallop', 'mussel', 'squid', 'octopus'],
    photos: ['1580822184713-fc5400e7fe10', '1559737219-f1b89a2eb6fc', '1519708227418-c8fd9a32b7a2'],
  },
  {
    keywords: ['sandwich', 'wrap', 'sub', 'panini', 'club'],
    photos: ['1550547660-d9450f859349', '1559181567-c3190e3d0ee3', '1586190848641-61d8e3052af8'],
  },
  {
    keywords: ['taco', 'burrito', 'quesadilla', 'enchilada', 'fajita', 'nacho', 'mexican'],
    photos: ['1565299585323-38d6b0865b47', '1551504734-5ee1c4a1479b', '1534422298391-e4f8c172dddb'],
  },
  {
    keywords: ['breakfast', 'pancake', 'waffle', 'omelette', 'omelet', 'french toast', 'scrambled egg', 'benedict'],
    photos: ['1484723091739-30a097e8f929', '1533089860892-a7c6f0a88666', '1567620905732-2d1ec7ab7445'],
  },
  {
    keywords: ['egg', 'frittata', 'quiche', 'yumurta'],
    photos: ['1567620905732-2d1ec7ab7445', '1484723091739-30a097e8f929', '1533089860892-a7c6f0a88666'],
  },
  {
    keywords: ['cake', 'brownie', 'muffin', 'cupcake', 'cookie', 'biscuit', 'cheesecake', 'tiramisu'],
    photos: ['1551024601-bec78aea704b', '1563729784474-d77dbb933a9e', '1488477181228-a90cae6a50e7'],
  },
  {
    keywords: ['pie', 'tart', 'crumble', 'cobbler'],
    photos: ['1565958011703-44f9829ba187', '1488477181228-a90cae6a50e7', '1551024601-bec78aea704b'],
  },
  {
    keywords: ['chocolate', 'dessert', 'pudding', 'mousse', 'parfait', 'ice cream', 'gelato', 'sweet'],
    photos: ['1488477181228-a90cae6a50e7', '1551024601-bec78aea704b', '1565958011703-44f9829ba187'],
  },
  {
    keywords: ['curry', 'tikka', 'masala', 'dal', 'dhal', 'korma', 'vindaloo', 'indian'],
    photos: ['1585937421612-70a008356fbe', '1505253758473-96b7015fcd40', '1574484284002-952d92456975'],
  },
  {
    keywords: ['bread', 'loaf', 'focaccia', 'baguette', 'sourdough', 'flatbread', 'naan', 'lavash', 'pita'],
    photos: ['1549931319-a545dcf3bc73', '1509440159596-0249088772ff', '1574484284002-952d92456975'],
  },
  {
    keywords: ['potato', 'fries', 'hash brown', 'mashed potato', 'kartof'],
    photos: ['1568625365131-079e026a927d', '1586201375761-83865001e31c', '1534482421-64566f976cfa'],
  },
  {
    keywords: ['corn', 'maize', 'polenta', 'grits'],
    photos: ['1558618666-fcd25c85cd64', '1476224203421-9ac39bcb3327', '1546069901-ba9599a7e63c'],
  },
  {
    keywords: ['stir fry', 'wok', 'sushi', 'dumpling', 'dim sum', 'wonton', 'teriyaki', 'pad thai', 'lo mein', 'chinese', 'japanese', 'korean', 'vietnamese', 'thai', 'asian'],
    photos: ['1607532941433-304659e8198a', '1569050467447-ce54b3bbc37d', '1580822184713-fc5400e7fe10'],
  },
  {
    keywords: ['vegan', 'tofu', 'tempeh', 'lentil', 'bean', 'legume', 'chickpea', 'hummus', 'falafel'],
    photos: ['1540420773420-3366772f4999', '1512621776951-a57141f2eefd', '1488459716781-31db52582fe9'],
  },
  {
    keywords: ['vegetable', 'veggie', 'roasted vegetable', 'grilled vegetable'],
    photos: ['1540420773420-3366772f4999', '1488459716781-31db52582fe9', '1512621776951-a57141f2eefd'],
  },
  {
    keywords: ['greek', 'mediterranean', 'kebab', 'gyro', 'shawarma', 'dolma', 'spanakopita'],
    photos: ['1540189549336-e6e99c3679fe', '1574484284002-952d92456975', '1565958011703-44f9829ba187'],
  },
  {
    keywords: ['mushroom', 'portobello'],
    photos: ['1476224203421-9ac39bcb3327', '1621996346565-e3dbc646d9a9', '1504674900247-0877df9cc836'],
  },
  {
    keywords: ['pork', 'bacon', 'ham', 'sausage', 'chorizo', 'ribs', 'pulled pork'],
    photos: ['1529693662653-9d480da3af58', '1546833999-b9f581a1996d', '1568901346375-23c9450c58cd'],
  },
  {
    keywords: ['lamb', 'mutton', 'qoyun', 'kuzu'],
    photos: ['1529693662653-9d480da3af58', '1601050690597-df0568f70950', '1574484284002-952d92456975'],
  },
  {
    keywords: ['bbq', 'barbecue', 'grill', 'smoked'],
    photos: ['1568901346375-23c9450c58cd', '1529042410759-befb1204b468', '1546833999-b9f581a1996d'],
  },
  {
    keywords: ['italian'],
    photos: ['1621996346565-e3dbc646d9a9', '1565299624946-b28f40a0ae38', '1555396273-367ea4eb4db5'],
  },
  {
    keywords: ['american'],
    photos: ['1568901346375-23c9450c58cd', '1529042410759-befb1204b468', '1546833999-b9f581a1996d'],
  },
  // Azerbaijani dishes
  {
    keywords: ['plov', 'pilaf', 'şah plov', 'levengi plov', 'qovurma plov', 'noxudlu', 'şüyüd plov', 'azerbaijani rice'],
    photos: ['1534422298391-e4f8c172dddb', '1603133872878-684f208fb84b', '1569050467447-ce54b3bbc37d'],
  },
  {
    keywords: ['dolma', 'dolması', 'dolmasi', 'stuffed grape', 'stuffed vine', 'yarpaq', 'badımcan dolma', 'biber dolma', 'kalam dolma'],
    photos: ['1565557623262-b51c2513a641', '1540189549336-e6e99c3679fe', '1574484284002-952d92456975'],
  },
  {
    keywords: ['kebab', 'kabab', 'lülə', 'lule', 'tika', 'şiş', 'sis', 'kiymə', 'cücə', 'grilled azerbaijani'],
    photos: ['1544025162-d76694265947', '1529693662653-9d480da3af58', '1601050690597-df0568f70950'],
  },
  {
    keywords: ['piti', 'bozbash', 'bozbaş', 'düşbərə', 'dushbara', 'kufta bozbash', 'dovğa', 'dovga', 'xaş', 'xash', 'umac', 'azerbaijani soup', 'qatıqlı'],
    photos: ['1547592166-23ac45744acd', '1604152135912-04a022e23696', '1571834124613-e7fb6ba0d258'],
  },
  {
    keywords: ['qutab', 'kutab', 'lavangi', 'levangi', 'xəngəl', 'xengel', 'azerbaijani bread', 'azerbaijani flatbread'],
    photos: ['1549931319-a545dcf3bc73', '1509440159596-0249088772ff', '1574484284002-952d92456975'],
  },
  {
    keywords: ['kükü', 'kuku', 'azerbaijani eggs', 'çığırtma', 'chigirtma'],
    photos: ['1567620905732-2d1ec7ab7445', '1484723091739-30a097e8f929', '1533089860892-a7c6f0a88666'],
  },
  {
    keywords: ['baklava', 'paklava', 'şəkərbura', 'sekerbura', 'badambura', 'halva', 'azerbaijani dessert', 'azerbaijani sweets', 'novruz'],
    photos: ['1551024601-bec78aea704b', '1488477181228-a90cae6a50e7', '1563729784474-d77dbb933a9e'],
  },
  {
    keywords: ['azerbaijani', 'azerbaycan', 'azerbaijani cuisine', 'qovurma', 'kufta', 'küftə', 'küftə', 'fəsəli', 'nar qovurma'],
    photos: ['1546833999-b9f581a1996d', '1529693662653-9d480da3af58', '1547592166-23ac45744acd'],
  },
];

const DEFAULT_PHOTOS = [
  '1546069901-ba9599a7e63c',
  '1476224203421-9ac39bcb3327',
  '1504674900247-0877df9cc836',
  '1565958011703-44f9829ba187',
  '1561043433-aaf687c4cf04',
];

function pickImage(cuisine: string, title: string): string {
  const text = `${title} ${cuisine}`.toLowerCase();
  for (const cat of FOOD_IMAGE_MAP) {
    if (cat.keywords.some((kw) => text.includes(kw))) {
      const pool = cat.photos;
      return `https://images.unsplash.com/photo-${pool[title.length % pool.length]}?w=800&q=80`;
    }
  }
  const pool = DEFAULT_PHOTOS;
  return `https://images.unsplash.com/photo-${pool[title.length % pool.length]}?w=800&q=80`;
}

export async function fetchPexelsImage(query: string): Promise<string | null> {
  if (!env.pexelsApiKey) return null;
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
      { headers: { Authorization: env.pexelsApiKey } },
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    const photos: any[] = data.photos ?? [];
    if (photos.length === 0) return null;

    // Pick the photo whose alt text best overlaps the query — the raw first result
    // is often unrelated (e.g. "piti azerbaijani" → Baku street scenes)
    const qWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    let best: any = null;
    let bestScore = 0;
    for (const p of photos) {
      const alt = (p.alt ?? '').toLowerCase();
      const score = qWords.filter((w) => alt.includes(w)).length;
      if (score > bestScore) { best = p; bestScore = score; }
    }
    // No photo mentions any query word → treat as "not found" so callers try the next source
    if (!best) return null;
    return best.src?.large ?? null;
  } catch {
    return null;
  }
}

// Google Images (via Serper) knows specific and local dishes by their real name
// ("Piti", "Dolma", "Chicken Alfredo") far better than stock-photo sites, so this
// is the most relevant source for a generated recipe's photo.
export async function fetchSerperImage(query: string): Promise<string | null> {
  if (!env.serperApiKey) return null;
  const cacheKey = query.trim().toLowerCase();
  const cached = serperImageCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': env.serperApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 12 }),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const images: any[] = data.images ?? [];
    if (images.length === 0) return null;

    // Skip pinterest/lookaside (hotlink-blocked or login-walled) and tiny images;
    // prefer a direct jpg/png/webp of reasonable size.
    const BAD_HOSTS = /(pinterest|lookaside|fbsbx|instagram|\.gif)/i;
    const isDirect = (u: string) => /\.(jpe?g|png|webp)(\?|$)/i.test(u);
    const good = images.find((im) => {
      const u = im.imageUrl ?? '';
      return u && isDirect(u) && !BAD_HOSTS.test(u) && (im.imageWidth ?? 0) >= 400;
    });
    const picked = (good ?? images.find((im) => im.imageUrl && !BAD_HOSTS.test(im.imageUrl)) ?? images[0])?.imageUrl ?? null;
    serperImageCache.set(cacheKey, picked);
    return picked;
  } catch {
    return null;
  }
}

// Persistent (cross-restart) reuse: if the same dish was generated before and we
// already resolved+stored an image for it, reuse that instead of paying for a new
// Serper/Pexels lookup. Case-insensitive exact title match keeps it safe.
async function findExistingImageByTitle(title: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from('recipes')
      .select('image_url')
      .ilike('title', title)
      .not('image_url', 'is', null)
      .limit(1)
      .maybeSingle();
    return (data as any)?.image_url ?? null;
  } catch {
    return null;
  }
}

// Wikimedia blocks generic HTTP clients (RN's okhttp gets 403), so wiki images
// must be re-hosted in Supabase Storage instead of hotlinked
export const RECIPE_IMAGES_BUCKET = 'recipe-images';

export async function rehostImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SavoraApp/1.0; recipe image fetch)' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;
    const rawBuf = Buffer.from(await res.arrayBuffer());

    // Downscale + recompress before storing so a full-res Google/Wikipedia image
    // (often 1–3MB) doesn't bloat Supabase Storage and slow down loads. Falls
    // back to the original bytes if the format can't be decoded (e.g. some webp).
    let buf = rawBuf;
    let ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    let outType = contentType;
    try {
      const img = await Jimp.read(rawBuf);
      if (img.getWidth() > 900) img.resize(900, Jimp.AUTO);
      img.quality(78);
      const jpg = Buffer.from(await img.getBufferAsync(Jimp.MIME_JPEG));
      // only keep the recompressed copy if it actually helped
      if (jpg.length < rawBuf.length) { buf = jpg; ext = 'jpg'; outType = 'image/jpeg'; }
    } catch {
      // keep original
    }

    const path = `wiki/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(RECIPE_IMAGES_BUCKET)
      .upload(path, buf, { contentType: outType, upsert: true });
    if (error) return null;

    return supabaseAdmin.storage.from(RECIPE_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

// Strip Azerbaijani/Turkish diacritics so "Dovğa" matches Wikipedia's "Dovga"
function normalizeDishName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// Wikipedia has real photos of local dishes (piti, qutab, dovğa) that stock photo
// sites lack. Only accept a page whose title tightly matches the dish name.
export async function fetchWikipediaImage(dishTitle: string): Promise<string | null> {
  const base = dishTitle.split('(')[0].trim();
  if (base.length < 3) return null;
  try {
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&generator=search' +
      `&gsrsearch=${encodeURIComponent(base + ' dish food')}&gsrlimit=3` +
      '&prop=pageimages&piprop=thumbnail&pithumbsize=800&format=json';
    const res = await fetch(url, { headers: { 'User-Agent': 'SavoraApp/1.0' } });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const pages = (Object.values(data?.query?.pages ?? {}) as any[])
      .sort((a, b) => (a.index ?? 9) - (b.index ?? 9));

    const dishNorm = normalizeDishName(base);
    const words = dishNorm.split(/\s+/);
    // Generic dish-type words: "Piti Stew" may match the "Piti" page, but
    // "Chickpea and Spinach Stew" must NOT match the "Chickpea" ingredient page
    const GENERIC_DISH_WORDS = new Set([
      'stew', 'soup', 'plov', 'pilaf', 'kebab', 'kabab', 'salad', 'bread',
      'rice', 'dish', 'baliq', 'corba', 'shorba', 'dolma', 'ashi', 'asi',
    ]);
    const firstWordMatchOk = words.length === 1 || (words.length === 2 && GENERIC_DISH_WORDS.has(words[1]));
    for (const p of pages) {
      if (!p.thumbnail?.source) continue;
      const pageNorm = normalizeDishName((p.title ?? '').split('(')[0]);
      if (!pageNorm) continue;
      // exact title match, or — for proper-name dishes only — the leading word
      // matches the page title ("Piti (food)" ← "Piti ...")
      if (pageNorm === dishNorm || (firstWordMatchOk && pageNorm === words[0])) {
        return p.thumbnail.source;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function getAndIncrementUsage(
  userId: string,
  field: UsageField,
  isPremium: boolean,
  isAdmin = false,
  isPro = false,
): Promise<void> {
  if (isAdmin) return; // unlimited for admin

  const today = new Date().toISOString().split('T')[0];
  const limit = isPro
    ? DAILY_LIMITS[field].pro
    : isPremium
      ? DAILY_LIMITS[field].premium
      : DAILY_LIMITS[field].free;

  const { data, error } = await supabaseAdmin
    .from('ai_usage')
    .upsert({ user_id: userId, date: today }, { onConflict: 'user_id,date' })
    .select()
    .single();

  if (error) throw new AppError(500, 'Usage tracking failed');

  if ((data[field] ?? 0) >= limit) {
    throw new AppError(
      429,
      `Daily ${field.replace('_count', '')} limit reached (${limit}/day).${isPremium ? '' : ' Upgrade to Premium for more.'}`,
    );
  }

  await supabaseAdmin
    .from('ai_usage')
    .update({ [field]: (data[field] ?? 0) + 1 })
    .eq('user_id', userId)
    .eq('date', today);
}

// ─── Web search helpers ────────────────────────────────────────────────────

// Simple in-memory TTL cache. Serper is billed per query, so caching identical
// dish research / image lookups (many users generate the same popular dishes)
// meaningfully cuts cost. Per-process; survives within a running instance.
function makeTTLCache<T>(ttlMs: number, max = 500) {
  const map = new Map<string, { value: T; expires: number }>();
  return {
    get(key: string): T | undefined {
      const e = map.get(key);
      if (!e) return undefined;
      if (Date.now() > e.expires) { map.delete(key); return undefined; }
      return e.value;
    },
    set(key: string, value: T): void {
      if (map.size >= max) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(key, { value, expires: Date.now() + ttlMs });
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const researchCache = makeTTLCache<string>(DAY_MS);
const serperImageCache = makeTTLCache<string | null>(DAY_MS);

async function serperSearch(query: string): Promise<string> {
  if (!env.serperApiKey) return '';
  const key = query.trim().toLowerCase();
  const cached = researchCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': env.serperApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    if (!res.ok) return '';
    const data = await res.json() as any;
    const snippets: string[] = [];
    for (const r of (data.organic ?? []).slice(0, 5)) {
      if (r.snippet) snippets.push(`${r.title}: ${r.snippet}`);
    }
    const result = snippets.join('\n');
    researchCache.set(key, result);
    return result;
  } catch { return ''; }
}

async function ddgSearch(query: string): Promise<string> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SavoraApp/1.0' } });
    if (!res.ok) return '';
    const data = await res.json() as any;
    const parts: string[] = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    for (const t of (data.RelatedTopics ?? []).slice(0, 4)) {
      if (t.Text) parts.push(t.Text);
    }
    return parts.join('\n');
  } catch { return ''; }
}

async function webSearch(query: string): Promise<string> {
  const serper = await serperSearch(query);
  if (serper) return serper;
  return ddgSearch(query);
}

// ─── Dish identification ────────────────────────────────────────────────────

const AZ_DISH_KNOWLEDGE = `
AZ DISHES: piti=clay-pot lamb+chickpea soup, bozbash=lamb stew, dovğa=yogurt+herb soup, düşbərə=tiny dumplings, xəngəl=pasta+meat+yogurt, qutab=stuffed flatbread, lavangi=walnut-stuffed chicken/fish, lülə kabab=minced meat skewer, plov=saffron rice pilaf, qovurma=slow-cooked lamb, küftə bozbash=meatball soup, dolma=stuffed grape leaves, qrənki/qrankı=beer mezesi (salty beer snacks: chips, nuts, crackers, dried fish, pickles), kəllə-paça=sheep head+feet soup, toyuq çığırtması=chicken in tomato-egg sauce, şəkərbura/paklava=Novruz pastries
AZ INGREDIENTS: mərci/merci=lentil, qatıq=yogurt, toyuq=chicken, ət=meat, balıq=fish, quzu=lamb, dana=beef, düyü=rice, yumurta=egg, pendir=cheese, soğan=onion, sarımsaq=garlic, pomidor=tomato, kartof=potato, kök=carrot, lobya=beans, qrecqa=buckwheat, un=flour, yağ=oil, kərə yağı=butter, şəkər=sugar, duz=salt, ispanaq=spinach, badımcan=eggplant, kəvər/şüyüd=dill, nanə=mint, göyərti=herbs
`;

// Non-English languages the app supports; used for lazy per-language translation
const LANG_INFO: Record<string, { name: string; durExample: string }> = {
  az: { name: 'Azerbaijani', durExample: '10 dəq' },
  ru: { name: 'Russian',     durExample: '10 мин' },
  tr: { name: 'Turkish',     durExample: '10 dk' },
};

function langKeyFromName(language?: string): 'en' | 'az' | 'ru' | 'tr' {
  const map: Record<string, 'en' | 'az' | 'ru' | 'tr'> = {
    english: 'en', azerbaijani: 'az', russian: 'ru', turkish: 'tr',
    en: 'en', az: 'az', ru: 'ru', tr: 'tr',
  };
  return map[(language ?? '').toLowerCase().trim()] ?? 'en';
}

async function researchDish(dishDescription: string): Promise<string> {
  // Step 1: Ask Groq to identify the dish using its training knowledge
  const identifyPrompt = `Dish to identify: "${dishDescription}"

${AZ_DISH_KNOWLEDGE}

Identify this dish concisely:
1. English name + original language name
2. What it is (2-3 sentences)
3. Key authentic ingredients (list)
4. Basic cooking method (3-4 sentences)
5. Cuisine, cook time, difficulty

Be accurate and concise. Use the knowledge above for Azerbaijani terms.`;

  const identified = await aiComplete('light', {
    messages: [
      { role: 'system', content: 'You are an expert chef and culinary historian. Provide accurate culinary information concisely.' },
      { role: 'user', content: identifyPrompt },
    ],
    temperature: 0.2,
    max_tokens: 700,
  } as any);

  // Step 2: If the dish seems unknown/uncertain, augment with web search
  const isUncertain = /don't know|not sure|unfamiliar|cannot find|no information|unclear/i.test(identified);
  if (isUncertain) {
    const searchQuery = `${dishDescription} recipe authentic ingredients`;
    const webResults = await webSearch(searchQuery);
    if (webResults) {
      return `RESEARCH RESULTS:\n${identified}\n\nWEB SEARCH RESULTS:\n${webResults}`;
    }
  }

  return identified;
}

// ─── generateRecipe ─────────────────────────────────────────────────────────

export async function generateRecipe(
  input: GenerateRecipeInput,
  userId: string,
  isPremium: boolean,
  isAdmin = false,
  isPro = false,
) {
  await getAndIncrementUsage(userId, 'recipes_count', isPremium, isAdmin, isPro);

  const { description: inputDescription, ingredients, preferences } = input;

  const notes = input.notes?.trim();
  const notesBlock = notes
    ? `\nUSER NOTES (HIGHEST PRIORITY — follow these exactly, e.g. ingredient swaps or dislikes like "use beef instead of chicken", "no ketchup", "extra spicy"): ${notes}\n`
    : '';

  const restrictions = preferences?.dietary_restrictions?.join(', ') || 'none';
  const cuisine      = preferences?.cuisine || 'any';
  const maxTime      = preferences?.max_cook_time || 60;
  const servings     = preferences?.servings || 2;
  const difficulty   = preferences?.difficulty || 'easy';

  // Extra taste-profile constraints from the user's saved preferences
  const prefLines = [
    preferences?.allergies?.length
      ? `- ALLERGIES (STRICT — the recipe MUST NOT contain these in any form): ${preferences.allergies.join(', ')}`
      : '',
    preferences?.disliked_ingredients?.length
      ? `- Disliked ingredients (avoid; if essential to the dish, offer a substitution): ${preferences.disliked_ingredients.join(', ')}`
      : '',
    preferences?.spice_level
      ? `- Spice level: ${preferences.spice_level} (adjust chili/pepper amounts accordingly)`
      : '',
    preferences?.favorite_proteins?.length
      ? `- Preferred proteins (favor when a choice exists): ${preferences.favorite_proteins.join(', ')}`
      : '',
    preferences?.health_goal
      ? `- Health goal: ${preferences.health_goal} (tune portions and macros toward it)`
      : '',
    preferences?.max_calories_per_meal
      ? `- Keep calories per serving under ~${preferences.max_calories_per_meal} kcal if realistically possible`
      : '',
  ].filter(Boolean).join('\n');

  // Full content only for English + the requesting user's language (cuts output ~3x);
  // every other language gets a title-only stub so lists and search work in all
  // languages immediately — bodies are translated lazily on first view
  const userLang = langKeyFromName(input.language);
  const langBlocks: string[] = [];
  if (userLang !== 'en') {
    langBlocks.push(`,
    "${userLang}": {
      "title": "...","description": "...","ingredients": [{"name":"...","amount":"..."}],
      "steps": [{"step":1,"instruction":"...","duration":"${LANG_INFO[userLang].durExample}"}],
      "tips": ["..."],"substitutions": [{"ingredient":"...","substitute":"...","note":"..."}],"storage": "..."
    }`);
  }
  for (const k of Object.keys(LANG_INFO).filter((k) => k !== userLang)) {
    langBlocks.push(`,
    "${k}": { "title": "dish name translated to ${LANG_INFO[k].name} — ONLY the title, no other fields" }`);
  }
  const extraLangJson = langBlocks.join('');

  let userPrompt: string;

  if (inputDescription) {
    // Research the dish first so the recipe is grounded in real culinary knowledge
    // (same grounding step suggestRecipes uses — prevents invented/wrong dishes)
    let dishContext = '';
    try {
      dishContext = await researchDish(inputDescription);
    } catch {
      // research is best-effort — fall back to the model's own knowledge
    }

    userPrompt = `DISH REQUESTED: "${inputDescription}"
${dishContext ? `
DISH RESEARCH (authoritative reference — base the recipe on this):
${dishContext}
` : ''}
STEP 1 - IDENTIFY: What exactly is this dish?
- It may be in Azerbaijani, Turkish, Russian, or any other language
- It may be slang or a local/regional name
- Azerbaijani terms: ${AZ_DISH_KNOWLEDGE.trim()}

STEP 2 - GENERATE: Create the authentic recipe for the identified dish.

Additional requirements:
- Dietary restrictions: ${restrictions}
- Max cooking time: ${maxTime} minutes
- Servings: ${servings}
${prefLines ? prefLines + '\n' : ''}${notesBlock}
Rules:
- NEVER substitute a different dish — if user asked for X, give X
- Use the proper culinary name (e.g. "piti" → "Piti (Azerbaijani Clay Pot Soup)", "qrənki" → "Azerbaijani Beer Mezesi (Qrənki)")
- Minimum 6 detailed steps — each must have technique detail, visual cue, and realistic duration
- Include practical tips (2-3) and at least 1-2 ingredient substitutions
- List all allergens present (gluten/dairy/eggs/nuts/fish/shellfish/soy/sesame)
- difficulty must be exactly "easy", "medium", or "hard" (lowercase only)

Return JSON with this exact structure:
{
  "cuisine": "cuisine name",
  "difficulty": "easy|medium|hard",
  "prep_time": 15,
  "cook_time": 45,
  "servings": 4,
  "estimated_cost": 8.50,
  "calories": 420,
  "protein": 28,
  "carbs": 42,
  "fat": 14,
  "fiber": 4,
  "sodium": 620,
  "allergens": ["gluten","dairy"],
  "tags": ["tag1","tag2"],
  "imageSearchQuery": "4-7 English words describing how the FINISHED dish looks: main visible ingredients + dish type + serving vessel (e.g. 'lamb chickpea stew clay pot'). NEVER use local/proper dish names or nationality words — stock photo sites don't know them",
  "translations": {
    "en": {
      "title": "Dish Name",
      "description": "2-3 sentence description of the dish, its origin and flavor profile.",
      "ingredients": [{"name":"chicken breast","amount":"500g"},{"name":"onion","amount":"1 large"}],
      "steps": [{"step":1,"instruction":"Detailed step with technique and visual cue.","duration":"10 min"},{"step":2,"instruction":"Next step...","duration":"15 min"}],
      "tips": ["Tip 1 for better results","Tip 2 for common mistakes to avoid"],
      "substitutions": [{"ingredient":"butter","substitute":"olive oil","note":"For dairy-free version"}],
      "storage": "Store in an airtight container in the refrigerator for up to 3 days. Reheat gently."
    }${extraLangJson}
  }
}`;
  } else {
    userPrompt = `AVAILABLE INGREDIENTS: ${ingredients!.join(', ')}

Create the best recipe using these ingredients as the base. You may add common pantry staples (salt, pepper, oil, water, basic spices).

Requirements:
- Dietary restrictions: ${restrictions}
- Max cooking time: ${maxTime} minutes
- Servings: ${servings}
${prefLines ? prefLines + '\n' : ''}${notesBlock}- Use the proper culinary name
- Minimum 6 detailed steps — each with technique, visual cue, and realistic duration
- Include practical cooking tips and ingredient substitutions
- difficulty must be exactly "easy", "medium", or "hard" (lowercase only)
- List all allergens present (gluten/dairy/eggs/nuts/fish/shellfish/soy/sesame)

Return JSON with this exact structure:
{
  "cuisine": "cuisine name",
  "difficulty": "easy|medium|hard",
  "prep_time": 15,
  "cook_time": 45,
  "servings": 4,
  "estimated_cost": 8.50,
  "calories": 420,
  "protein": 28,
  "carbs": 42,
  "fat": 14,
  "fiber": 4,
  "sodium": 620,
  "allergens": ["gluten","dairy"],
  "tags": ["tag1","tag2"],
  "imageSearchQuery": "4-7 English words describing how the FINISHED dish looks: main visible ingredients + dish type + serving vessel (e.g. 'lamb chickpea stew clay pot'). NEVER use local/proper dish names or nationality words — stock photo sites don't know them",
  "translations": {
    "en": {
      "title": "Dish Name",
      "description": "2-3 sentence description of the dish, its origin and flavor profile.",
      "ingredients": [{"name":"chicken breast","amount":"500g"},{"name":"onion","amount":"1 large"}],
      "steps": [{"step":1,"instruction":"Detailed step with technique and visual cue.","duration":"10 min"},{"step":2,"instruction":"Next step...","duration":"15 min"}],
      "tips": ["Tip 1 for better results","Tip 2 for common mistakes to avoid"],
      "substitutions": [{"ingredient":"butter","substitute":"olive oil","note":"For dairy-free version"}],
      "storage": "Store in an airtight container in the refrigerator for up to 3 days. Reheat gently."
    }${extraLangJson}
  }
}`;
  }

  let raw: string;
  try {
    raw = await aiComplete('heavy', {
      messages: [
        {
          role: 'system',
          content: `You are a professional chef and culinary expert with deep knowledge of world cuisines, especially Azerbaijani, Turkish, Russian, and Middle Eastern food.

RULES:
- ALWAYS identify the dish correctly before generating a recipe
- NEVER invent random recipes — provide authentic, accurate recipes from your culinary knowledge
- All ingredients must be real, safe, edible food products only
- Ingredient amounts must be specific and realistic (metric preferred: g, ml, ədəd) — never vague like "some" or "a bit"
- All nutrition values (calories, protein, carbs, fat, fiber, sodium) are PER SERVING and must be realistic for the dish
- difficulty must be exactly "easy", "medium", or "hard" (lowercase only)
- steps must include a realistic "duration" for each step (e.g. "5 min", "15 min")
- allergens must only include: gluten, dairy, eggs, nuts, fish, shellfish, soy, sesame (only those present)
- TRANSLATIONS must be native-quality, natural culinary language — NOT word-for-word literal translation.
  Use correct Azerbaijani culinary terms (salmon=qızılbalıq, beef=mal əti, ground meat=qiymə, bake=bişirmək,
  fry=qızartmaq, simmer=zəif odda bişirmək, dough=xəmir). Same for Russian and Turkish.
- Every language requested in the JSON structure must be COMPLETE (every ingredient and every step translated, same counts as en)
- Return valid JSON only, no markdown, no extra text`,
        },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      // en + user-language recipe JSON can approach 8k output tokens — a low cap
      // truncates the JSON and surfaces as "AI returned invalid JSON"
      max_tokens: 16000,
      response_format: { type: 'json_object' },
    } as any);
  } catch (err: any) {
    throw err;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      parsed = JSON.parse(match[1]);
    } else {
      throw new AppError(500, 'AI returned invalid JSON');
    }
  }

  const trans = parsed.translations ?? {};
  const en = trans.en ?? {};

  const title       = en.title       ?? parsed.title       ?? 'AI Recipe';
  const description = en.description ?? parsed.description ?? '';
  const ingr        = en.ingredients ?? parsed.ingredients ?? [];
  const steps       = en.steps       ?? parsed.steps       ?? [];

  // Reject incomplete generations instead of saving broken recipes
  if (!Array.isArray(ingr) || ingr.length < 2 || !Array.isArray(steps) || steps.length < 3) {
    throw new AppError(500, 'AI returned an incomplete recipe. Please try again.');
  }

  // Title-only stubs are valid (lists/search work; body translates lazily on view).
  // A language with broken/incomplete body content is reduced to a title stub so
  // the app cleanly falls back to English instead of showing half-translated text.
  for (const langKey of ['az', 'ru', 'tr']) {
    const c = trans[langKey];
    if (!c) continue;
    if (!c.title) { delete trans[langKey]; continue; }
    const hasBody = Array.isArray(c.ingredients) || Array.isArray(c.steps);
    const bodyOk =
      Array.isArray(c.ingredients) && c.ingredients.length === ingr.length &&
      Array.isArray(c.steps)       && c.steps.length       === steps.length;
    if (hasBody && !bodyOk) trans[langKey] = { title: c.title };
  }

  // New enriched fields from research document recommendations
  const allergens      = Array.isArray(parsed.allergens) ? parsed.allergens : [];
  const estimated_cost = typeof parsed.estimated_cost === 'number' ? parsed.estimated_cost : null;
  const fiber          = typeof parsed.fiber  === 'number' ? parsed.fiber  : null;
  const sodium         = typeof parsed.sodium === 'number' ? parsed.sodium : null;

  // Normalize difficulty — DB check constraint only accepts lowercase easy/medium/hard
  const rawDiff = (parsed.difficulty ?? 'medium').toString().toLowerCase().trim();
  const difficulty_val = (['easy', 'medium', 'hard'] as const).includes(rawDiff as any)
    ? (rawDiff as 'easy' | 'medium' | 'hard')
    : 'medium';

  // Image source chain (most → least relevant), re-hosted in Supabase Storage
  // so RN can always load it:
  //   1. Wikipedia — real photos of named local dishes
  //   2. Google Images (Serper) by dish name — knows specific & local dishes
  //   3. Google Images (Serper) by the AI's visual description
  //   4. Pexels (visual description, then title) → keyword map (last resort)
  const cleanTitle = title.split('(')[0].trim();
  let imageUrl: string | null = null;

  // Reuse an already-resolved image for the same dish (free, persistent).
  imageUrl = await findExistingImageByTitle(title);

  if (!imageUrl) {
    const wikiUrl = await fetchWikipediaImage(title);
    if (wikiUrl) imageUrl = await rehostImage(wikiUrl);
  }

  if (!imageUrl) {
    const g = await fetchSerperImage(`${cleanTitle} recipe dish food`);
    if (g) imageUrl = await rehostImage(g);
  }
  if (!imageUrl && parsed.imageSearchQuery) {
    const g = await fetchSerperImage(`${parsed.imageSearchQuery} dish`);
    if (g) imageUrl = await rehostImage(g);
  }
  if (!imageUrl && parsed.imageSearchQuery) imageUrl = await fetchPexelsImage(parsed.imageSearchQuery);
  if (!imageUrl) imageUrl = await fetchPexelsImage(`${cleanTitle} food dish`);
  if (!imageUrl) imageUrl = pickImage(parsed.cuisine ?? '', title);

  const saved = await createRecipe({
    title,
    description,
    cuisine:         parsed.cuisine,
    difficulty:      difficulty_val,
    prep_time:       parsed.prep_time,
    cook_time:       parsed.cook_time,
    servings:        parsed.servings,
    calories:        parsed.calories,
    protein:         parsed.protein,
    carbs:           parsed.carbs,
    fat:             parsed.fat,
    tags:            (Array.isArray(parsed.tags) ? parsed.tags : []).map((t: any) => String(t).toLowerCase().trim()),
    ingredients:     ingr,
    steps,
    image_url:       imageUrl,
    translations:    Object.keys(trans).length > 0 ? trans : undefined,
    is_ai_generated: true,
    created_by:      userId,
  });

  // Attach enriched fields to response (in-memory extras beyond DB schema)
  return {
    ...saved,
    ...(Object.keys(trans).length > 0 && { translations: trans }),
    ...(allergens.length > 0 && { allergens }),
    ...(estimated_cost !== null && { estimated_cost }),
    ...(fiber  !== null && { fiber }),
    ...(sodium !== null && { sodium }),
  };
}

// ─── ensureRecipeTranslation ────────────────────────────────────────────────
// Recipes are generated with only en + the creator's language. When a recipe is
// opened in a language it doesn't have yet, translate it once (light tier) and
// persist — subsequent reads are served from the DB with no AI call.

export async function ensureRecipeTranslation(recipe: any, langKey: string) {
  const info = LANG_INFO[langKey];
  if (!info) return recipe;
  const existing = recipe.translations ?? {};
  // A title-only stub (from generation) is not a full translation — only skip
  // when the body is already translated
  const stub = existing[langKey];
  if (stub?.steps?.length) return recipe;

  const en = existing.en ?? {};
  const source = {
    title:         en.title         ?? recipe.title,
    description:   en.description   ?? recipe.description ?? '',
    ingredients:   en.ingredients   ?? recipe.ingredients ?? [],
    steps:         en.steps         ?? recipe.steps ?? [],
    tips:          en.tips          ?? [],
    substitutions: en.substitutions ?? [],
    storage:       en.storage       ?? '',
  };
  if (!source.title || !Array.isArray(source.ingredients) || source.ingredients.length === 0
      || !Array.isArray(source.steps) || source.steps.length === 0) {
    return recipe;
  }

  const raw = await aiComplete('light', {
    messages: [
      {
        role: 'system',
        content: `You are a professional culinary translator. Translate recipes into native-quality, natural ${info.name} culinary language — NOT word-for-word literal translation.
Use correct culinary terms (Azerbaijani: salmon=qızılbalıq, beef=mal əti, ground meat=qiymə, bake=bişirmək, fry=qızartmaq, simmer=zəif odda bişirmək, dough=xəmir. Same care for Russian and Turkish).
Keep amounts, numbers, and units unchanged. Keep the "step" numbers unchanged. Translate step durations naturally (e.g. "${info.durExample}").
Return valid JSON only with EXACTLY the same structure and array lengths as the input — no markdown, no extra text.`,
      },
      {
        role: 'user',
        content: `Translate this recipe to ${info.name}:\n${JSON.stringify(source)}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 6000,
    response_format: { type: 'json_object' },
  } as any);

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!match) return recipe; // translation is best-effort — serve untranslated
    try { parsed = JSON.parse(match[1]); } catch { return recipe; }
  }

  // Reject incomplete translations so the app cleanly falls back to English
  if (
    !parsed?.title ||
    !Array.isArray(parsed.ingredients) || parsed.ingredients.length !== source.ingredients.length ||
    !Array.isArray(parsed.steps)       || parsed.steps.length       !== source.steps.length
  ) {
    return recipe;
  }

  // Keep the stub title from generation — the heavy model named the dish with
  // full context, so it beats the light model's re-translation
  const merged = { ...existing, [langKey]: stub?.title ? { ...parsed, title: stub.title } : parsed };
  try {
    await updateRecipeTranslations(recipe.id, merged);
  } catch {
    // persist failure shouldn't block serving the translated content
  }
  return { ...recipe, translations: merged };
}

interface PlanCandidate {
  id: string;
  title: string;
  localizedTitle: string;
  calories: number | null;
}

// Ingredient keywords per app allergy label (recipes store no allergen tags)
const PLAN_ALLERGY_MAP: Record<string, { keywords: string[] }> = {
  'Peanuts':        { keywords: ['peanut'] },
  'Tree Nuts':      { keywords: ['walnut', 'almond', 'hazelnut', 'cashew', 'pistachio'] },
  'Shellfish':      { keywords: ['shrimp', 'prawn', 'crab', 'lobster', 'mussel'] },
  'Fish':           { keywords: ['fish', 'salmon', 'tuna', 'anchov', 'trout'] },
  'Eggs':           { keywords: ['egg'] },
  'Soy':            { keywords: ['soy', 'tofu'] },
  'Wheat / Gluten': { keywords: ['flour', 'wheat', 'bulgur', 'pasta'] },
  'Milk / Dairy':   { keywords: ['milk', 'butter', 'cheese', 'cream', 'yogurt'] },
  'Sesame':         { keywords: ['sesame', 'tahini'] },
  'Mustard':        { keywords: ['mustard'] },
};

const PLAN_PROTEIN_KEYWORDS: Record<string, string[]> = {
  'Chicken': ['chicken'], 'Beef': ['beef', 'veal'], 'Lamb': ['lamb', 'mutton'],
  'Fish': ['fish', 'salmon', 'tuna', 'trout'], 'Seafood': ['shrimp', 'prawn', 'squid', 'mussel'],
  'Eggs': ['egg'], 'Legumes': ['lentil', 'chickpea', 'bean'], 'Tofu': ['tofu'],
};

/**
 * Pull DB recipes that fit the user's taste profile so the meal-plan AI can
 * schedule real, openable recipes instead of inventing everything.
 */
async function fetchPlanCandidates(input: MealPlanInput, langKey: string): Promise<PlanCandidate[]> {
  // NOTE: recipes has no allergens column — allergy filtering relies on
  // ingredient-name keywords below
  const { data, error } = await supabaseAdmin
    .from('recipes')
    .select('id, title, calories, cuisine, tags, ingredients, translations')
    .limit(200);
  if (error || !data) return [];

  const cuisines = (input.cuisine_preference ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const dietary  = (input.dietary_preferences ?? []).map((d) => d.toLowerCase().replace(/[^a-z]/g, ''));

  const scored = data
    .filter((r) => {
      const names = ((r.ingredients ?? []) as { name?: string }[]).map((i) => i.name ?? '').join(' ').toLowerCase();
      for (const allergy of input.allergies ?? []) {
        const rule = PLAN_ALLERGY_MAP[allergy];
        if (!rule) continue;
        if (rule.keywords.some((k) => names.includes(k))) return false;
      }
      for (const disliked of input.disliked_ingredients ?? []) {
        const d = disliked.trim().toLowerCase();
        if (d.length >= 3 && names.includes(d)) return false;
      }
      return true;
    })
    .map((r) => {
      const tags = ((r.tags ?? []) as string[]).map((t) => t.toLowerCase().replace(/[^a-z]/g, ''));
      const names = ((r.ingredients ?? []) as { name?: string }[]).map((i) => i.name ?? '').join(' ').toLowerCase();
      let score = 0;
      if (r.cuisine && cuisines.some((c) => r.cuisine.toLowerCase().includes(c))) score += 3;
      for (const d of dietary) if (tags.some((t) => t.includes(d))) score += 2;
      for (const p of input.favorite_proteins ?? []) {
        if ((PLAN_PROTEIN_KEYWORDS[p] ?? []).some((k) => names.includes(k))) { score += 2; break; }
      }
      if (input.health_goal === 'Gain Muscle' && tags.includes('highprotein')) score += 1;
      if (input.health_goal === 'Lose Weight' && r.calories != null && r.calories <= 500) score += 1;
      return {
        id: r.id,
        title: r.title as string,
        localizedTitle: ((r.translations as any)?.[langKey]?.title as string) ?? (r.title as string),
        calories: r.calories ?? null,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 45);

  return scored;
}

export async function generateMealPlan(
  input: MealPlanInput,
  userId: string,
  isPremium: boolean,
  isAdmin = false,
  isPro = false,
): Promise<{ inserted: number }> {
  await getAndIncrementUsage(userId, 'meal_plans_count', isPremium, isAdmin, isPro);

  const calorieGoal = input.calorie_goal ?? 2000;
  const budget = input.budget ?? 'moderate';
  const location = input.location ?? 'International';
  const dietary = input.dietary_preferences?.join(', ') || 'none';
  const spice = input.spice_level ?? 'Medium';
  const cuisinePref = input.cuisine_preference ?? 'varied';
  const mealLang = (input as any).language || 'English';
  const mealLangNote = mealLang !== 'English' ? `\n- Generate all meal names and titles in ${mealLang}` : '';
  const todayDay = (input as any).today_day_index ?? 0;
  const futureDaysNote = todayDay > 0
    ? `\n- IMPORTANT: Only generate meals for days ${todayDay} through 6 (0=Monday). Skip days 0 through ${todayDay - 1}. Still include all 7 objects in week_plan but set empty meals array for past days.`
    : '';

  const budgetDesc = budget === 'budget' ? 'inexpensive ingredients available at any grocery store'
    : budget === 'premium' ? 'high-quality and premium ingredients'
    : 'moderately priced ingredients';

  const allergies   = input.allergies;
  const dislikedIng = input.disliked_ingredients;
  const favProteins = input.favorite_proteins;
  const mealsPerDay = input.meals_per_day;
  const healthGoal  = input.health_goal;

  const extraPrefLines = [
    allergies?.length   ? `\n- ALLERGIES (STRICT — no meal may contain these in any form): ${allergies.join(', ')}` : '',
    dislikedIng?.length ? `\n- Disliked ingredients (avoid across the whole plan): ${dislikedIng.join(', ')}` : '',
    favProteins?.length ? `\n- Preferred proteins (feature these often): ${favProteins.join(', ')}` : '',
    healthGoal          ? `\n- Health goal: ${healthGoal} (tune meal choices and macros toward it)` : '',
  ].join('');

  const mealsLine = mealsPerDay && mealsPerDay >= 4
    ? `- Include breakfast, lunch, dinner and ${mealsPerDay - 3 > 1 ? `${mealsPerDay - 3} snacks` : 'a snack'} for each day (${mealsPerDay} meals/day)`
    : mealsPerDay === 2
    ? '- Include lunch and dinner for each day (2 meals/day)'
    : '- Include breakfast, lunch, and dinner for each day';

  // Real recipes from our DB, pre-filtered by allergies/dislikes and ranked by
  // taste preferences — the plan should be built from these wherever possible
  const langKey = langKeyFromName(input.language);
  const candidates = await fetchPlanCandidates(input, langKey).catch(() => [] as PlanCandidate[]);
  const candidatesBlock = candidates.length > 0
    ? `\n\nAVAILABLE RECIPES FROM THE APP DATABASE (title | approx. kcal per serving):
${candidates.map((c) => `- ${c.localizedTitle}${c.calories ? ` | ${c.calories} kcal` : ''}`).join('\n')}

DATABASE RULES:
- STRONGLY PREFER meals from this list — the user can open these recipes in the app with photos and step-by-step instructions
- For lunch and dinner, pick from the list whenever a dish fits the requirements (aim for most of them)
- Copy the title EXACTLY as written above (do not translate, rephrase or decorate it)
- Only invent a meal when nothing in the list fits the slot (e.g. simple breakfasts or snacks)`
    : '';

  const prompt = `You are a professional nutritionist and meal planner AI. Generate a complete 7-day meal plan.

REQUIREMENTS:
- Location/Region: ${location} (use regionally available foods)
- Budget: ${budget} (${budgetDesc})
- Daily calorie goal: ~${calorieGoal} kcal total (spread across meals)
- Dietary preferences: ${dietary}
- Spice level preference: ${spice}
- Cuisine preference: ${cuisinePref}${extraPrefLines}
${mealsLine}
- Vary the meals so there's no repetition across the week
- Calories should be realistic and sum close to ${calorieGoal} per day${mealLangNote}${futureDaysNote}${candidatesBlock}

Return ONLY valid JSON with this exact structure:
{
  "week_plan": [
    {
      "day": 0,
      "meals": [
        { "meal_type": "breakfast", "title": "Meal name", "calories": 350 },
        { "meal_type": "lunch",     "title": "Meal name", "calories": 550 },
        { "meal_type": "dinner",    "title": "Meal name", "calories": 600 }
      ]
    },
    { "day": 1, "meals": [...] },
    { "day": 2, "meals": [...] },
    { "day": 3, "meals": [...] },
    { "day": 4, "meals": [...] },
    { "day": 5, "meals": [...] },
    { "day": 6, "meals": [...] }
  ]
}`;

  let raw: string;
  try {
    raw = await aiComplete('heavy', {
      messages: [
        { role: 'system', content: 'You are a meal planning AI. Always respond with valid JSON only, no markdown, no extra text.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      // 7 days × up to 6 meals with non-English titles can exceed a low cap —
      // truncated output surfaces as "AI returned invalid JSON"
      max_tokens: 6000,
      response_format: { type: 'json_object' },
    } as any);
  } catch (err: any) {
    throw err;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        throw new AppError(500, 'AI returned invalid JSON');
      }
    } else {
      throw new AppError(500, 'AI returned invalid JSON');
    }
  }

  const weekPlan: any[] = parsed.week_plan ?? [];
  const items: any[] = [];

  // Link generated meals back to real DB recipes (by en or localized title)
  // so the app can open them directly from the plan. az locale lowercasing
  // keeps İ/ı from breaking the comparison.
  const normTitle = (s: string) => s.normalize('NFC').trim().toLocaleLowerCase('az');
  const byTitle = new Map<string, PlanCandidate>();
  for (const c of candidates) {
    byTitle.set(normTitle(c.title), c);
    byTitle.set(normTitle(c.localizedTitle), c);
  }

  for (const dayPlan of weekPlan) {
    const dayOfWeek = Number(dayPlan.day);
    if (dayOfWeek < todayDay) continue; // Skip past days
    for (const meal of dayPlan.meals ?? []) {
      const match = byTitle.get(normTitle(String(meal.title ?? '')));
      items.push({
        day_of_week:  dayOfWeek,
        meal_type:    meal.meal_type,
        recipe_title: meal.title,
        recipe_id:    match?.id ?? null,
        calories:     meal.calories ?? match?.calories ?? null,
      });
    }
  }

  if (items.length === 0) throw new AppError(500, 'AI returned empty meal plan');

  const { data: existingPlan } = await supabaseAdmin
    .from('meal_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start', input.week_start)
    .single();

  let planId: string;
  if (existingPlan) {
    planId = existingPlan.id;
    await supabaseAdmin.from('meal_plan_items').delete().eq('meal_plan_id', planId);
  } else {
    const { data: newPlan, error: planErr } = await supabaseAdmin
      .from('meal_plans')
      .insert({ user_id: userId, week_start: input.week_start })
      .select('id')
      .single();
    if (planErr || !newPlan) throw new AppError(500, 'Could not create meal plan');
    planId = newPlan.id;
  }

  const insertItems = items.map((item) => ({ ...item, meal_plan_id: planId }));
  const { error } = await supabaseAdmin.from('meal_plan_items').insert(insertItems);
  if (error) throw new AppError(500, error.message);

  return { inserted: insertItems.length };
}

const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

// Non-food words that vision models commonly hallucinate — hard filter as a last line of defense
const NON_FOOD_BLACKLIST = [
  'computer', 'laptop', 'keyboard', 'mouse', 'screen', 'monitor', 'phone', 'tablet',
  'desk', 'table', 'chair', 'furniture', 'book', 'paper', 'pen', 'pencil', 'bottle',
  'cup', 'glass', 'plate', 'bowl', 'utensil', 'fork', 'knife', 'spoon', 'pan', 'pot',
  'wall', 'floor', 'window', 'door', 'lamp', 'light', 'cable', 'wire', 'charger',
  'plastic', 'metal', 'wood', 'fabric', 'cloth', 'towel', 'bag', 'box', 'container',
  'person', 'hand', 'face', 'clothing', 'shirt', 'toy', 'remote', 'television', 'tv',
];

export async function scanIngredients(imageBase64: string): Promise<{ ingredients: string[] }> {
  const prompt = `You are analyzing a photo for a cooking app. Your job is to identify ONLY food ingredients that are CLEARLY AND UNAMBIGUOUSLY visible in the image.

STEP 1 — Decide: does this image actually contain real, physical food items?
- Photos of electronics, computers, screens, furniture, rooms, people, documents, pets, vehicles, etc. contain NO food.
- A photo of a screen SHOWING food is NOT real food — reject it.
- Empty plates, utensils, appliances (fridge exterior, microwave) with no visible food = NO food.

STEP 2 — Only if real food is clearly visible, list each ingredient you can positively identify.

Return ONLY a JSON object with this exact structure:
{
  "food_visible": true or false,
  "ingredients": [
    {"name": "tomato", "confidence": "high"},
    {"name": "garlic", "confidence": "medium"}
  ]
}

STRICT RULES:
- NEVER guess or infer. If you are not sure an item is food, do not include it.
- confidence must be "high" (certain), "medium" (probably), or "low" (unsure)
- Only include items you can actually SEE — do not assume what "might" be in a fridge/bag/box
- Use simple common names ("chicken breast", "garlic", "tomato"), no brand names
- For packaged products, only include them if the packaging clearly shows a food product (e.g. a pasta box → "pasta")
- If the image has no real food: {"food_visible": false, "ingredients": []}
- Return ONLY the JSON, no markdown, no explanation`;

  try {
    let raw: string | null = null;

    // Gemini Flash-Lite is the primary vision model; Groq llama-4-scout is the fallback
    if (env.gemini.apiKey) {
      try {
        raw = await geminiVision({
          model: GEMINI_LIGHT_MODEL,
          imageBase64,
          prompt,
          temperature: 0.1,
          maxTokens: 512,
          json: true,
        });
      } catch (err: any) {
        console.warn(`[ai] Gemini vision failed (${err.message}) — falling back to Groq`);
      }
    }

    if (raw === null) {
      const completion = await groq.chat.completions.create({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 512,
        response_format: { type: 'json_object' },
      } as any);
      raw = completion.choices[0].message.content ?? '{}';
    }

    const parsed = JSON.parse(raw);

    if (parsed.food_visible === false) return { ingredients: [] };

    const rawList: any[] = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
    const ingredients = rawList
      // accept both old string format and new {name, confidence} format
      .map((i: any) => (typeof i === 'string' ? { name: i, confidence: 'high' } : i))
      .filter((i: any) => i && typeof i.name === 'string' && i.name.trim().length > 0)
      // drop low-confidence guesses — the main source of hallucinated ingredients
      .filter((i: any) => i.confidence === 'high' || i.confidence === 'medium')
      .map((i: any) => i.name.trim().toLowerCase())
      .filter((name: string) => !NON_FOOD_BLACKLIST.some((bad) => name === bad || name.includes(bad)));

    return { ingredients: [...new Set(ingredients)] as string[] };
  } catch (err: any) {
    throw new AppError(503, `Vision AI error: ${err.message}`);
  }
}

// ─── Calorie Counter (Premium/Pro only) ─────────────────────────────────────

export interface CalorieAnalysis {
  food_detected: boolean;
  dish_name?: string;
  portion?: string;
  items?: { name: string; amount: string; calories: number; protein: number; carbs: number; fat: number }[];
  total?: { calories: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number; sodium: number };
  confidence?: 'high' | 'medium' | 'low';
  note?: string;
}

function calorieJsonSpec(langName: string): string {
  return `Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "food_detected": true or false,
  "dish_name": "short dish name in ${langName}",
  "portion": "the portion you analyzed, in ${langName} (e.g. '1 plate (~350 g)')",
  "items": [
    {"name": "component name in ${langName}", "amount": "~150 g", "calories": 240, "protein": 8, "carbs": 30, "fat": 9}
  ],
  "total": {"calories": 520, "protein": 28, "carbs": 45, "fat": 22, "fiber": 6, "sugar": 8, "sodium": 750},
  "confidence": "high" | "medium" | "low",
  "note": "one short helpful sentence in ${langName} (assumptions made, or a nutrition remark)"
}

ESTIMATION METHOD — follow these steps exactly, in order:
1. Identify every distinct food component (max 8). Do not skip cooking fat: fried/sautéed dishes absorb oil or butter — include it as its own item.
2. Estimate each component's weight in GRAMS from the stated portion or visual cues (plate diameter ~26 cm, spoon ~15 ml, palm-size meat ~100 g, 1 cup cooked rice ~160 g).
3. For each component, recall its standard per-100 g values from nutrition databases (USDA / national food tables) and scale linearly to the estimated weight. Use COOKED values for cooked food (cooked rice ~130 kcal/100 g, not dry ~360).
4. For each item verify: calories ≈ 4×protein + 4×carbs + 9×fat (within 10%). If not, fix the item before answering.
5. "total" must be the exact sum of the items (fiber/sugar/sodium estimated across the whole dish).

RULES:
- All macro values are grams; sodium is milligrams; calories are kcal. Numbers only, no units inside numbers.
- Estimates must reflect the ACTUAL portion size, not a generic 100 g reference.
- Traditional dishes (plov, dolma, borsch, kebab…): use their authentic recipe composition.
- If no real food: {"food_detected": false} and nothing else is required.`;
}

export async function analyzeCalories(
  input: AnalyzeCaloriesInput,
  userId: string,
  isPremium: boolean,
  isAdmin = false,
  isPro = false,
): Promise<CalorieAnalysis> {
  if (!isAdmin && !isPremium && !isPro) {
    throw new AppError(403, 'Calorie Counter is a Premium feature. Upgrade to unlock it.');
  }
  await getAndIncrementUsage(userId, 'calories_count', isPremium, isAdmin, isPro);

  const codeMap: Record<string, string> = { en: 'English', az: 'Azerbaijani', ru: 'Russian', tr: 'Turkish' };
  const langName = codeMap[input.language ?? 'en'] ?? input.language ?? 'English';

  let raw: string | null = null;

  if (input.image_base64) {
    const prompt = `You are a nutritionist analyzing a photo of food for a calorie-counter app.

STEP 1 — Decide: does this image actually contain real, physical food or drink?
- Photos of electronics, screens, furniture, people, documents, pets etc. contain NO food.
- A photo of a screen SHOWING food is NOT real food — reject it.
- Empty plates or appliances with no visible food = NO food.

STEP 2 — Only if real food is visible: identify the dish and estimate the portion size from visual cues (plate size, utensils, packaging), then estimate its nutrition.

${calorieJsonSpec(langName)}`;

    // Heavy model for accuracy (portion + nutrition estimation is harder than
    // ingredient listing); Groq llama-4-scout is the fallback
    if (env.gemini.apiKey) {
      try {
        raw = await geminiVision({
          model: GEMINI_HEAVY_MODEL,
          imageBase64: input.image_base64,
          prompt,
          temperature: 0.1,
          maxTokens: 1536,
          json: true,
        });
      } catch (err: any) {
        console.warn(`[ai] Gemini vision failed (${err.message}) — falling back to Groq`);
      }
    }

    if (raw === null) {
      const completion = await groq.chat.completions.create({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.image_base64}` } },
              { type: 'text', text: prompt },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 1536,
        response_format: { type: 'json_object' },
      } as any);
      raw = completion.choices[0].message.content ?? '{}';
    }
  } else {
    const portion = input.portion?.trim()
      ? `Portion: ${input.portion.trim()}`
      : 'Portion: not specified — assume one standard serving and say so in "portion".';
    const prompt = `You are a nutritionist for a calorie-counter app. Estimate the nutrition of this food:

Food: ${input.food_name}
${portion}

The food name may be in Azerbaijani, Turkish, Russian or English.
If the text is not actually a food or drink, return {"food_detected": false}.

${calorieJsonSpec(langName)}`;

    raw = await aiComplete('heavy', {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1536,
      response_format: { type: 'json_object' },
    } as any);
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.food_detected === false) return { food_detected: false };

    const num = (v: any) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : 0);
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((i: any) => i && typeof i.name === 'string')
      .slice(0, 8)
      .map((i: any) => ({
        name: String(i.name),
        amount: typeof i.amount === 'string' ? i.amount : '',
        calories: num(i.calories),
        protein: num(i.protein),
        carbs: num(i.carbs),
        fat: num(i.fat),
      }));

    // Deterministic consistency pass — LLM arithmetic is its weakest link.
    // Per item: calories must match Atwater (4P + 4C + 9F); correct it if >20% off.
    for (const i of items) {
      const atwater = 4 * i.protein + 4 * i.carbs + 9 * i.fat;
      if (atwater > 0 && (i.calories === 0 || Math.abs(i.calories - atwater) / atwater > 0.2)) {
        i.calories = Math.round(atwater);
      }
    }

    const t = parsed.total ?? {};
    const total = {
      calories: num(t.calories),
      protein:  num(t.protein),
      carbs:    num(t.carbs),
      fat:      num(t.fat),
      fiber:    num(t.fiber),
      sugar:    num(t.sugar),
      sodium:   num(t.sodium),
    };

    // Totals: trust the (corrected) item sums over the model's own addition
    if (items.length > 0) {
      const sum = (k: 'calories' | 'protein' | 'carbs' | 'fat') =>
        items.reduce((a: number, i: any) => a + i[k], 0);
      total.calories = sum('calories');
      total.protein  = sum('protein');
      total.carbs    = sum('carbs');
      total.fat      = sum('fat');
    } else {
      const atwater = 4 * total.protein + 4 * total.carbs + 9 * total.fat;
      if (atwater > 0 && (total.calories === 0 || Math.abs(total.calories - atwater) / atwater > 0.2)) {
        total.calories = Math.round(atwater);
      }
    }

    return {
      food_detected: true,
      dish_name: typeof parsed.dish_name === 'string' ? parsed.dish_name : input.food_name ?? '',
      portion: typeof parsed.portion === 'string' ? parsed.portion : input.portion ?? '',
      items,
      total,
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
      note: typeof parsed.note === 'string' ? parsed.note : undefined,
    };
  } catch {
    throw new AppError(503, 'Calorie analysis failed — invalid AI response. Please try again.');
  }
}

export async function chatWithAI(
  input: ChatInput,
  userId: string,
  isPremium: boolean,
  isAdmin = false,
  isPro = false,
): Promise<{ reply: string }> {
  await getAndIncrementUsage(userId, 'ai_chat_count', isPremium, isAdmin, isPro);

  const rawChatLang = (input as any).language || 'English';
  const codeMap: Record<string, string> = { en: 'English', az: 'Azerbaijani', ru: 'Russian', tr: 'Turkish' };
  const chatLanguage = codeMap[rawChatLang] ?? rawChatLang;
  const langNote = chatLanguage !== 'English' ? ` Always respond in ${chatLanguage}.` : '';

  const cookingContext = (input.context ?? '').trim();

  const systemPrompt = cookingContext
    ? `You are Savora AI, a calm and expert cooking assistant helping someone who is cooking RIGHT NOW, step by step.${langNote}

Live context:
${cookingContext}

Rules:
- Answer their question for THIS specific recipe and THIS step. Be concrete and actionable.
- Keep it very short: 1-3 sentences, no lists unless truly needed. They are at the stove and need a quick answer.
- Be reassuring — cooking mistakes are usually fixable. Tell them exactly what to do next.
- Do NOT tell them to use other app features or generate a new recipe. Just help them finish this dish.`
    : `You are Savora AI, a friendly and knowledgeable cooking assistant built into the Savora recipe app.${langNote}
You help users with:
- Recipe ideas and cooking techniques
- Ingredient substitutions
- Nutritional information
- Meal planning advice
- Kitchen tips and tricks

Keep responses concise (2-4 sentences max), warm, and practical. If the user asks for a specific recipe, give a brief overview and suggest they use the "Generate Recipe" feature in the app for a full detailed recipe with ingredients and steps. If the user asks about meal planning, mention the Meal Planner feature. If they ask about grocery shopping, mention the Shopping List feature.`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...(input.history ?? []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: input.message },
  ];

  try {
    const reply = await aiComplete('light', { messages, temperature: 0.7, max_tokens: 512 } as any);
    return { reply: reply || "I'm sorry, I couldn't generate a response." };
  } catch (err: any) {
    throw err;
  }
}

export interface RecipeSuggestion {
  name: string;
  nameEn: string;
  description: string;
  mainIngredients: string[];
  cuisine: string;
  cookTime: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

export async function suggestRecipes(
  input: SuggestRecipesInput,
  userId: string,
  isPremium: boolean,
  isAdmin = false,
  isPro = false,
): Promise<{ suggestions: RecipeSuggestion[] }> {
  await getAndIncrementUsage(userId, 'suggestions_count', isPremium, isAdmin, isPro);

  const rawLang = input.language || 'en';
  const codeMap: Record<string, string> = { en: 'English', az: 'Azerbaijani', ru: 'Russian', tr: 'Turkish' };
  const langName = codeMap[rawLang] ?? rawLang; // handles both 'az' and 'Azerbaijani'

  // Research the dish first so suggestions are grounded in real knowledge
  const dishContext = await researchDish(input.query);

  const isAz = langName === 'Azerbaijani';
  const isRu = langName === 'Russian';
  const isTr = langName === 'Turkish';
  const exampleName = isAz ? 'Yoğurtlu Dovğa' : isRu ? 'Суп из йогурта' : isTr ? 'Yoğurtlu Çorba' : 'Yogurt Soup';
  const exampleDesc = isAz ? 'Bu şorbada qatıq əsas inqrediyentdir. Çox dadlı bir Azərbaycan yeməyidir.' : isRu ? 'Это суп на основе йогурта. Очень вкусное азербайджанское блюдо.' : isTr ? 'Bu çorba yoğurt bazlıdır. Çok lezzetli bir Azerbaycan yemeğidir.' : 'This soup is yogurt-based. A delicious traditional dish.';
  const exampleIng = isAz ? '["qatıq", "soğan", "düyü", "kəvər"]' : isRu ? '["йогурт", "лук", "рис", "укроп"]' : isTr ? '["yoğurt", "soğan", "pirinç", "dereotu"]' : '["yogurt", "onion", "rice", "dill"]';

  const prompt = `User typed: "${input.query}"

DISH RESEARCH (what this dish actually is — use as authoritative reference):
${dishContext}

⚠️ CRITICAL LANGUAGE RULE: Write ALL text fields in ${langName.toUpperCase()}. Only "nameEn" and "cuisine" stay in English.

TASK: Suggest exactly 5 DIFFERENT real dishes directly related to the user's request.

WHAT TO SUGGEST:
- If the query is an INGREDIENT (e.g. chicken, yogurt, lentils): 5 well-known dishes featuring it, each from a DIFFERENT cooking style (e.g. one soup, one grilled/kebab, one rice dish, one stew, one baked/salad)
- If the query is a SPECIFIC DISH: the authentic classic version FIRST, then real, named regional or traditional variations; if not enough real variations exist, complete the list with closely related well-known dishes from the same cuisine

STRICT QUALITY RULES:
1. Every suggestion must be a REAL dish that people actually cook and that has an established name. NEVER invent dish names.
2. FORBIDDEN: lazy "X with Y" combos ("Salad with walnuts", "Chicken with yogurt") unless that exact dish is a real named classic. If you cannot name 5 real variations, suggest related real dishes instead.
3. Each "description" = 2 sentences in ${langName} with SPECIFIC facts about that dish (key flavor, texture, cooking method, or origin). Every description must be clearly different — do NOT reuse the same sentence pattern 5 times.
4. "mainIngredients" must reflect that dish's actual signature ingredients — do not copy the same list into all 5.
5. "cookTime" must be realistic for that dish (a salad is not 90 minutes).
6. "name" = the dish's real name in ${langName}; "nameEn" = its real English culinary name (an accurate translation/transliteration, e.g. "Toyuq Ləvəngi" → "Chicken Lavangi", NOT a wrong dish name).

EXAMPLE (language = ${langName}):
{
  "suggestions": [{
    "name": "${exampleName}",
    "nameEn": "Yogurt Soup",
    "description": "${exampleDesc}",
    "mainIngredients": ${exampleIng},
    "cuisine": "Azerbaijani",
    "cookTime": 30,
    "difficulty": "easy"
  }]
}

Return ONLY valid JSON with 5 suggestions.`;

  let raw: string;
  try {
    // 'heavy' (Gemini Flash): suggestions are the most quality-sensitive user-facing
    // output — Flash-Lite fabricates dish names and repeats description templates
    raw = await aiComplete('heavy', {
      messages: [
        {
          role: 'system',
          content: `You are an expert chef AI with deep knowledge of world cuisines, especially Azerbaijani, Turkish, Russian, and Middle Eastern food. Return valid JSON only, no markdown. CRITICAL: All text fields (name, description, mainIngredients) MUST be in ${langName}. Only "nameEn" and "cuisine" stay in English. Only suggest REAL dishes with established names — never fabricate dish names or suggest unrelated dishes.`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    } as any);
  } catch (err: any) {
    throw err;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(500, 'AI returned invalid JSON');
  }

  const suggestions: RecipeSuggestion[] = (parsed.suggestions ?? []).slice(0, 5).map((s: any) => {
    const d = (s.difficulty ?? 'medium').toString().toLowerCase().trim();
    return {
      ...s,
      difficulty: (['easy', 'medium', 'hard'] as const).includes(d as any) ? d : 'medium',
    } as RecipeSuggestion;
  });
  return { suggestions };
}
