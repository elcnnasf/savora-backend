import { generateRecipe } from './services/aiService';
import { supabaseAdmin } from './config/supabase';

async function main() {
  const res: any = await generateRecipe(
    { description: 'düşbərə' } as any,
    '00000000-0000-0000-0000-000000000000',
    false,
    true, // isAdmin — skips usage tracking
  );
  console.log('title:', res.title);
  console.log('cuisine:', res.cuisine, '| difficulty:', res.difficulty, '| steps:', res.translations?.en?.steps?.length);
  console.log('az title:', res.translations?.az?.title);
  console.log('az ingredients:', (res.translations?.az?.ingredients ?? []).slice(0, 4).map((i: any) => `${i.name} (${i.amount})`).join(', '));
  console.log('az step1:', res.translations?.az?.steps?.[0]?.instruction);
  console.log('ru title:', res.translations?.ru?.title);
  console.log('tr title:', res.translations?.tr?.title);
  await supabaseAdmin.from('recipes').delete().eq('id', res.id);
  console.log('(test recipe deleted from DB)');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
