import dotenv from 'dotenv';
dotenv.config();

import { supabaseAdmin } from './config/supabase';

const PEXELS_KEY = process.env.PEXELS_API_KEY ?? '';
const DELAY_MS   = 350;

// ── Curated keyword → Unsplash mapping (same as aiService.ts) ─────────────
const FOOD_IMAGE_MAP: { keywords: string[]; photos: string[] }[] = [
  { keywords: ['pasta', 'spaghetti', 'noodle', 'fettuccine', 'penne', 'linguine', 'ravioli', 'lasagna', 'rigatoni', 'tagliatelle', 'macaroni'], photos: ['1621996346565-e3dbc646d9a9', '1555396273-367ea4eb4db5', '1546549032-9571cd6b27df'] },
  { keywords: ['pizza'], photos: ['1565299624946-b28f40a0ae38', '1513104890138-7c749659a591', '1571997478133-b82cb9f4d8a9'] },
  { keywords: ['soup', 'stew', 'chowder', 'broth', 'bisque', 'chili', 'ramen', 'pho', 'minestrone', 'goulash', 'shorba'], photos: ['1547592166-23ac45744acd', '1604152135912-04a022e23696', '1571834124613-e7fb6ba0d258'] },
  { keywords: ['salad', 'slaw', 'coleslaw'], photos: ['1512621776951-a57141f2eefd', '1540189549336-e6e99c3679fe', '1488459716781-31db52582fe9'] },
  { keywords: ['rice', 'pilaf', 'risotto', 'fried rice', 'biryani', 'paella', 'pilav'], photos: ['1534422298391-e4f8c172dddb', '1603133872878-684f208fb84b', '1569050467447-ce54b3bbc37d'] },
  { keywords: ['chicken', 'poultry', 'hen', 'toyuq'], photos: ['1598103442097-8b74394b95c3', '1604908176997-125f25cc6f3d', '1432139555190-58524dae6a55'] },
  { keywords: ['beef', 'steak', 'meatball', 'meatloaf', 'ground beef', 'brisket', 'dana', 'kotlet'], photos: ['1546833999-b9f581a1996d', '1601050690597-df0568f70950', '1529693662653-9d480da3af58'] },
  { keywords: ['burger', 'hamburger', 'slider'], photos: ['1568901346375-23c9450c58cd', '1550547660-d9450f859349', '1529042410759-befb1204b468'] },
  { keywords: ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout', 'sea bass', 'baliq'], photos: ['1614975059251-992f11792b9f', '1519708227418-c8fd9a32b7a2', '1535140728325-a4d3707eee61'] },
  { keywords: ['shrimp', 'prawn', 'seafood', 'lobster', 'crab', 'scallop', 'mussel', 'squid', 'octopus'], photos: ['1580822184713-fc5400e7fe10', '1559737219-f1b89a2eb6fc', '1519708227418-c8fd9a32b7a2'] },
  { keywords: ['sandwich', 'wrap', 'sub', 'panini', 'club'], photos: ['1550547660-d9450f859349', '1559181567-c3190e3d0ee3', '1586190848641-61d8e3052af8'] },
  { keywords: ['taco', 'burrito', 'quesadilla', 'enchilada', 'fajita', 'nacho', 'mexican'], photos: ['1565299585323-38d6b0865b47', '1551504734-5ee1c4a1479b', '1534422298391-e4f8c172dddb'] },
  { keywords: ['breakfast', 'pancake', 'waffle', 'omelette', 'omelet', 'french toast', 'scrambled egg', 'benedict'], photos: ['1484723091739-30a097e8f929', '1533089860892-a7c6f0a88666', '1567620905732-2d1ec7ab7445'] },
  { keywords: ['egg', 'frittata', 'quiche', 'yumurta'], photos: ['1567620905732-2d1ec7ab7445', '1484723091739-30a097e8f929', '1533089860892-a7c6f0a88666'] },
  { keywords: ['cake', 'brownie', 'muffin', 'cupcake', 'cookie', 'biscuit', 'cheesecake', 'tiramisu'], photos: ['1551024601-bec78aea704b', '1563729784474-d77dbb933a9e', '1488477181228-a90cae6a50e7'] },
  { keywords: ['pie', 'tart', 'crumble', 'cobbler'], photos: ['1565958011703-44f9829ba187', '1488477181228-a90cae6a50e7', '1551024601-bec78aea704b'] },
  { keywords: ['chocolate', 'dessert', 'pudding', 'mousse', 'parfait', 'ice cream', 'gelato', 'sweet'], photos: ['1488477181228-a90cae6a50e7', '1551024601-bec78aea704b', '1565958011703-44f9829ba187'] },
  { keywords: ['curry', 'tikka', 'masala', 'dal', 'dhal', 'korma', 'vindaloo', 'indian'], photos: ['1585937421612-70a008356fbe', '1505253758473-96b7015fcd40', '1574484284002-952d92456975'] },
  { keywords: ['bread', 'loaf', 'focaccia', 'baguette', 'sourdough', 'flatbread', 'naan', 'lavash', 'pita'], photos: ['1549931319-a545dcf3bc73', '1509440159596-0249088772ff', '1574484284002-952d92456975'] },
  { keywords: ['potato', 'fries', 'hash brown', 'mashed potato', 'kartof'], photos: ['1568625365131-079e026a927d', '1586201375761-83865001e31c', '1534482421-64566f976cfa'] },
  { keywords: ['corn', 'maize', 'polenta', 'grits'], photos: ['1558618666-fcd25c85cd64', '1476224203421-9ac39bcb3327', '1546069901-ba9599a7e63c'] },
  { keywords: ['stir fry', 'wok', 'sushi', 'dumpling', 'dim sum', 'wonton', 'teriyaki', 'pad thai', 'lo mein', 'chinese', 'japanese', 'korean', 'vietnamese', 'thai', 'asian'], photos: ['1607532941433-304659e8198a', '1569050467447-ce54b3bbc37d', '1580822184713-fc5400e7fe10'] },
  { keywords: ['vegan', 'tofu', 'tempeh', 'lentil', 'bean', 'legume', 'chickpea', 'hummus', 'falafel'], photos: ['1540420773420-3366772f4999', '1512621776951-a57141f2eefd', '1488459716781-31db52582fe9'] },
  { keywords: ['vegetable', 'veggie', 'roasted vegetable', 'grilled vegetable'], photos: ['1540420773420-3366772f4999', '1488459716781-31db52582fe9', '1512621776951-a57141f2eefd'] },
  { keywords: ['greek', 'mediterranean', 'gyro', 'shawarma', 'spanakopita'], photos: ['1540189549336-e6e99c3679fe', '1574484284002-952d92456975', '1565958011703-44f9829ba187'] },
  { keywords: ['mushroom', 'portobello'], photos: ['1476224203421-9ac39bcb3327', '1621996346565-e3dbc646d9a9', '1504674900247-0877df9cc836'] },
  { keywords: ['pork', 'bacon', 'ham', 'sausage', 'chorizo', 'ribs', 'pulled pork'], photos: ['1529693662653-9d480da3af58', '1546833999-b9f581a1996d', '1568901346375-23c9450c58cd'] },
  { keywords: ['lamb', 'mutton', 'qoyun', 'kuzu'], photos: ['1529693662653-9d480da3af58', '1601050690597-df0568f70950', '1574484284002-952d92456975'] },
  { keywords: ['bbq', 'barbecue', 'grill', 'smoked'], photos: ['1568901346375-23c9450c58cd', '1529042410759-befb1204b468', '1546833999-b9f581a1996d'] },
  // ── Azerbaijani dishes ─────────────────────────────────────────────────
  { keywords: ['plov', 'şah plov', 'levengi plov', 'qovurma plov', 'noxudlu', 'şüyüd plov', 'azerbaijani rice'], photos: ['1534422298391-e4f8c172dddb', '1603133872878-684f208fb84b', '1569050467447-ce54b3bbc37d'] },
  { keywords: ['dolma', 'dolması', 'dolmasi', 'stuffed grape', 'stuffed vine', 'yarpaq dolma', 'badımcan dolma', 'biber dolma', 'kalam dolma', 'heyva dolma', 'soğan dolma', 'quince dolma'], photos: ['1565557623262-b51c2513a641', '1540189549336-e6e99c3679fe', '1574484284002-952d92456975'] },
  { keywords: ['kebab', 'kabab', 'lülə', 'lule', 'tika', 'şiş kabab', 'cücə kabab', 'balıq kabab', 'soğan kabab', 'tava kabab'], photos: ['1544025162-d76694265947', '1529693662653-9d480da3af58', '1601050690597-df0568f70950'] },
  { keywords: ['piti', 'bozbash', 'bozbaş', 'düşbərə', 'dushbara', 'kufta bozbash', 'dovğa', 'dovga', 'xaş', 'xash', 'umac', 'azerbaijani soup', 'qatıqlı', 'albalı şorbası', 'sour cherry soup'], photos: ['1547592166-23ac45744acd', '1604152135912-04a022e23696', '1571834124613-e7fb6ba0d258'] },
  { keywords: ['qutab', 'kutab', 'lavangi', 'levengi', 'xəngəl', 'xengel', 'azerbaijani flatbread', 'ətli qutab', 'göyərtili qutab', 'balqabağlı qutab'], photos: ['1549931319-a545dcf3bc73', '1509440159596-0249088772ff', '1574484284002-952d92456975'] },
  { keywords: ['kükü', 'kuku', 'çığırtma', 'chigirtma', 'azerbaijani omelette', 'ispanaq kükü', 'herb omelette'], photos: ['1567620905732-2d1ec7ab7445', '1484723091739-30a097e8f929', '1533089860892-a7c6f0a88666'] },
  { keywords: ['paklava', 'baklava', 'şəkərbura', 'sekerbura', 'badambura', 'halva', 'azerbaijani dessert', 'azerbaijani sweets', 'novruz', 'firni', 'saffron rice pudding', 'chestnut dessert', 'rose water cookie', 'şabalıd', 'gülabı'], photos: ['1551024601-bec78aea704b', '1488477181228-a90cae6a50e7', '1563729784474-d77dbb933a9e'] },
  { keywords: ['qovurma', 'kufta', 'küftə', 'fəsəli', 'nar qovurma', 'pomegranate chicken', 'fesenjan', 'levengi toyuq', 'saffron chicken', 'çığırtma', 'tava eti', 'lamb liver', 'ciyər', 'veal with prune', 'gavalılı'], photos: ['1546833999-b9f581a1996d', '1529693662653-9d480da3af58', '1547592166-23ac45744acd'] },
  { keywords: ['reşta', 'xəngəl', 'sweet noodle', 'şirin reşta', 'azerbaijani noodle'], photos: ['1621996346565-e3dbc646d9a9', '1555396273-367ea4eb4db5', '1546549032-9571cd6b27df'] },
  { keywords: ['süzmə', 'qatıq', 'ovdux', 'azerbaijani yogurt', 'azerbaijani dairy'], photos: ['1542736143-29a8432162bc', '1547592180-85f173990554', '1571834124613-e7fb6ba0d258'] },
  { keywords: ['çoban salatı', 'göyərti salatı', 'azerbaijani salad', 'herb salad'], photos: ['1512621776951-a57141f2eefd', '1540189549336-e6e99c3679fe', '1488459716781-31db52582fe9'] },
  { keywords: ['tandır', 'lavaş', 'azerbaijani bread', 'shor qoğal'], photos: ['1549931319-a545dcf3bc73', '1509440159596-0249088772ff', '1574484284002-952d92456975'] },
  { keywords: ['bağlama', 'eggplant walnut', 'köz badımcan', 'smoked eggplant', 'turşu', 'pickled', 'azerbaijani appetizer', 'cold appetizer'], photos: ['1617196034183-421b4040ed20', '1512621776951-a57141f2eefd', '1540189549336-e6e99c3679fe'] },
  { keywords: ['güveç', 'kartof qovurması', 'potato stew', 'azerbaijani stew', 'lamb chickpea', 'lamb quince', 'azerbaijani lamb', 'stuffed lamb', 'lamb rib', 'lamb tongue'], photos: ['1547592166-23ac45744acd', '1604152135912-04a022e23696', '1529693662653-9d480da3af58'] },
  { keywords: ['narsharab', 'pomegranate sauce', 'mürəbbə', 'compote', 'dried fruit'], photos: ['1606923829579-0cb981a83e2e', '1559181567-c3190b6aa3b5', '1565958011703-44f9829ba187'] },
];

const DEFAULT_PHOTOS = ['1546069901-ba9599a7e63c', '1476224203421-9ac39bcb3327', '1504674900247-0877df9cc836', '1565958011703-44f9829ba187', '1561043433-aaf687c4cf04'];

function pickCurated(title: string, cuisine: string): { url: string; matched: boolean } {
  const text = `${title} ${cuisine}`.toLowerCase();
  for (const cat of FOOD_IMAGE_MAP) {
    if (cat.keywords.some((kw) => text.includes(kw))) {
      const pool = cat.photos;
      return {
        url: `https://images.unsplash.com/photo-${pool[title.length % pool.length]}?w=800&q=80`,
        matched: true,
      };
    }
  }
  return {
    url: `https://images.unsplash.com/photo-${DEFAULT_PHOTOS[title.length % DEFAULT_PHOTOS.length]}?w=800&q=80`,
    matched: false,
  };
}

async function fetchPexels(query: string): Promise<string | null> {
  if (!PEXELS_KEY) return null;
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query + ' food dish')}&per_page=3&orientation=landscape`,
      { headers: { Authorization: PEXELS_KEY } },
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.photos?.[0]?.src?.large2x ?? data.photos?.[0]?.src?.large ?? null;
  } catch { return null; }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const { data: recipes, error } = await supabaseAdmin
    .from('recipes')
    .select('id, title, cuisine')
    .order('title');

  if (error || !recipes) { console.error('Failed to fetch recipes:', error?.message); process.exit(1); }

  console.log(`\nUpdating images for ${recipes.length} recipes...\n`);
  console.log('Strategy: curated Unsplash for known dishes → Pexels for unknown\n');

  let curatedOk = 0;
  let pexelsOk  = 0;
  let defaultOk = 0;

  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    process.stdout.write(`[${i + 1}/${recipes.length}] "${r.title}" → `);

    const { url: curatedUrl, matched } = pickCurated(r.title, r.cuisine ?? '');

    let finalUrl = curatedUrl;
    let source = 'curated';

    if (!matched) {
      // Try Pexels for unrecognized dishes
      const pexelsUrl = await fetchPexels(r.title);
      if (pexelsUrl) {
        finalUrl = pexelsUrl;
        source = 'pexels';
      } else {
        source = 'default';
      }
      await sleep(DELAY_MS);
    }

    const { error: updateErr } = await supabaseAdmin
      .from('recipes')
      .update({ image_url: finalUrl })
      .eq('id', r.id);

    if (updateErr) {
      console.log(`FAIL (${updateErr.message})`);
    } else {
      console.log(`OK [${source}]`);
      if (source === 'curated') curatedOk++;
      else if (source === 'pexels') pexelsOk++;
      else defaultOk++;
    }
  }

  console.log('\n==== SUMMARY ====');
  console.log(`Total:   ${recipes.length}`);
  console.log(`Curated Unsplash: ${curatedOk}`);
  console.log(`Pexels:           ${pexelsOk}`);
  console.log(`Default fallback: ${defaultOk}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
