import { supabaseAdmin } from './config/supabase';

// Remove duplicate recipes (same title), keeping the earliest-created copy.
async function dedup() {
  const { data, error } = await supabaseAdmin
    .from('recipes')
    .select('id, title, created_at')
    .order('created_at', { ascending: true });
  if (error) { console.error('Fetch error:', error.message); return; }

  const seen = new Set<string>();
  const idsToDelete: string[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.title)) {
      idsToDelete.push(row.id);
    } else {
      seen.add(row.title);
    }
  }

  console.log(`Total rows: ${data?.length}, unique titles: ${seen.size}, duplicates to delete: ${idsToDelete.length}`);

  if (idsToDelete.length > 0) {
    const { error: delErr } = await supabaseAdmin.from('recipes').delete().in('id', idsToDelete);
    if (delErr) { console.error('Delete error:', delErr.message); return; }
    console.log(`Deleted ${idsToDelete.length} duplicate rows.`);
  }

  const { count } = await supabaseAdmin
    .from('recipes')
    .select('*', { count: 'exact', head: true })
    .eq('cuisine', 'Azerbaijani');
  console.log(`Azerbaijani recipes remaining: ${count}`);
}

dedup().catch(console.error);
