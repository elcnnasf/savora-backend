import { supabaseAdmin } from './config/supabase';

async function main() {
  console.log('Adding translations column to recipes table...');

  // Use rpc to run raw SQL via the admin client
  const { error } = await (supabaseAdmin as any).rpc('execute_sql', {
    sql: 'ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS translations JSONB;'
  });

  if (error) {
    // Try alternative: direct REST call to run SQL
    console.log('RPC method failed, trying direct approach...');
    // Check if column exists by trying to select it
    const probe = await supabaseAdmin.from('recipes').select('translations').limit(1);
    if (!probe.error) {
      console.log('Column already exists!');
      return;
    }
    console.error('Could not add column:', error.message);
    console.log('\nPlease run this SQL manually in your Supabase SQL Editor:');
    console.log('ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS translations JSONB;');
    process.exit(1);
  }

  console.log('Migration successful!');
}

main().catch(console.error);
