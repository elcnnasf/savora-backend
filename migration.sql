ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS translations JSONB;
CREATE INDEX IF NOT EXISTS idx_recipes_translations ON public.recipes USING GIN (translations);
