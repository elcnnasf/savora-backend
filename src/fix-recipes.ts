import { supabaseAdmin } from './config/supabase';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Maintenance script:
 *  A) Remove duplicate recipes (same title) — keep the earliest created_at.
 *  B) Fix is_ai_generated = false for all Azerbaijani recipes (they are seeded, not AI).
 *  C) Add a `translations` JSONB column. supabase-js cannot run DDL, so we attempt an
 *     `exec_sql` RPC and, failing that, write migration.sql for the Supabase SQL Editor.
 */

const MIGRATION_SQL = `ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS translations JSONB;
CREATE INDEX IF NOT EXISTS idx_recipes_translations ON public.recipes USING GIN (translations);
`;

async function dedup(): Promise<number> {
  const { data: all, error } = await supabaseAdmin
    .from('recipes')
    .select('id, title, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('  [DEDUP] fetch error:', error.message);
    return 0;
  }

  const seen = new Map<string, string>();
  const toDelete: string[] = [];
  for (const r of all ?? []) {
    if (seen.has(r.title)) toDelete.push(r.id);
    else seen.set(r.title, r.id);
  }

  console.log(`  [DEDUP] total rows: ${all?.length ?? 0}, unique titles: ${seen.size}, duplicates: ${toDelete.length}`);

  if (toDelete.length > 0) {
    // delete in chunks to stay well under URL limits
    for (let i = 0; i < toDelete.length; i += 100) {
      const chunk = toDelete.slice(i, i + 100);
      const { error: delErr } = await supabaseAdmin.from('recipes').delete().in('id', chunk);
      if (delErr) {
        console.error('  [DEDUP] delete error:', delErr.message);
        break;
      }
    }
    console.log(`  [DEDUP] deleted ${toDelete.length} duplicate recipes`);
  } else {
    console.log('  [DEDUP] no duplicates found');
  }
  return toDelete.length;
}

async function fixAiGenerated(): Promise<number> {
  // First count how many are currently true so we can report.
  const { count: before } = await supabaseAdmin
    .from('recipes')
    .select('*', { count: 'exact', head: true })
    .eq('cuisine', 'Azerbaijani')
    .eq('is_ai_generated', true);

  const { error } = await supabaseAdmin
    .from('recipes')
    .update({ is_ai_generated: false })
    .eq('cuisine', 'Azerbaijani');

  if (error) {
    console.error('  [AI_FLAG] update error:', error.message);
    return 0;
  }
  console.log(`  [AI_FLAG] set is_ai_generated = false for Azerbaijani recipes (was true on ${before ?? 'unknown'} rows)`);
  return before ?? 0;
}

async function addTranslationsColumn(): Promise<boolean> {
  // 1) Does the column already exist? Probe with a select.
  const probe = await supabaseAdmin.from('recipes').select('translations').limit(1);
  if (!probe.error) {
    console.log('  [MIGRATION] translations column already exists — nothing to do');
    return true;
  }

  // 2) Try an exec_sql RPC if the project happens to expose one.
  const rpc = await supabaseAdmin.rpc('exec_sql', { sql: MIGRATION_SQL });
  if (!rpc.error) {
    console.log('  [MIGRATION] translations column added via exec_sql RPC');
    return true;
  }

  // 3) Fallback: write migration.sql for manual execution.
  const outPath = path.join(process.cwd(), 'migration.sql');
  fs.writeFileSync(outPath, MIGRATION_SQL, 'utf8');
  console.log(`  [MIGRATION] supabase-js cannot run DDL (rpc: ${rpc.error.message}).`);
  console.log(`  [MIGRATION] Wrote ${outPath}`);
  console.log('  >>> Please run migration.sql in Supabase SQL Editor before running the next step. <<<');
  return false;
}

async function main() {
  console.log('STEP A — Dedup');
  const deleted = await dedup();

  console.log('STEP B — Fix is_ai_generated');
  const fixed = await fixAiGenerated();

  console.log('STEP C — Add translations column');
  const columnReady = await addTranslationsColumn();

  console.log('\n==== SUMMARY ====');
  console.log(`Duplicates deleted:        ${deleted}`);
  console.log(`is_ai_generated fixed:     ${fixed}`);
  console.log(`translations column ready: ${columnReady ? 'yes' : 'NO — run migration.sql manually'}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
