-- ============================================================
-- COLLECTIONS ("playlists" of saved recipes) + sharing
-- Run this once against the Supabase project (SQL editor).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.collections (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  emoji      TEXT,
  color      TEXT,
  -- opaque slug used for public share links; NULL until the user shares it
  share_id   TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.collection_recipes (
  collection_id UUID REFERENCES public.collections(id) ON DELETE CASCADE,
  recipe_id     UUID REFERENCES public.recipes(id)     ON DELETE CASCADE,
  added_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (collection_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_collections_user       ON public.collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_share      ON public.collections(share_id);
CREATE INDEX IF NOT EXISTS idx_collection_recipes_col ON public.collection_recipes(collection_id);

-- RLS: the API uses the service role (bypasses RLS) and filters by user_id in
-- code, but enable RLS as a safety net for any anon/authenticated access.
ALTER TABLE public.collections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_recipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_collections" ON public.collections;
CREATE POLICY "own_collections" ON public.collections
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own_collection_recipes" ON public.collection_recipes;
CREATE POLICY "own_collection_recipes" ON public.collection_recipes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_recipes.collection_id AND c.user_id = auth.uid()
    )
  );
