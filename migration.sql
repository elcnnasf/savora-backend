ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS translations JSONB;
CREATE INDEX IF NOT EXISTS idx_recipes_translations ON public.recipes USING GIN (translations);

-- Taste Preferences sync (2026-07-04): full wizard answers stored per account
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS taste_prefs JSONB;
