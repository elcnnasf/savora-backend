import { supabaseAdmin } from './config/supabase';

async function main() {
  console.log('Probing recipes table columns…\n');

  // Try selecting a known column
  const { data: d1, error: e1 } = await supabaseAdmin
    .from('recipes')
    .select('id, title')
    .limit(1);
  console.log('Select id,title:', e1 ? `ERROR: ${e1.message}` : `OK — ${JSON.stringify(d1?.[0])}`);

  // Try selecting translations column
  const { data: d2, error: e2 } = await supabaseAdmin
    .from('recipes')
    .select('translations')
    .limit(1);
  console.log('Select translations:', e2 ? `ERROR: ${e2.message} (code: ${e2.code})` : `OK — value: ${JSON.stringify(d2?.[0]?.translations)}`);

  // Try a count to see how many rows exist
  const { count, error: e3 } = await supabaseAdmin
    .from('recipes')
    .select('*', { count: 'exact', head: true });
  console.log('Row count:', e3 ? `ERROR: ${e3.message}` : `${count} rows`);
}

main().catch(console.error);
