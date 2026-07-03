-- ============================================================
-- SAVORA DATABASE SCHEMA
-- Run this in Supabase SQL Editor (supabase.com/dashboard)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id             UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name           TEXT NOT NULL,
  avatar_url     TEXT,
  is_premium     BOOLEAN DEFAULT FALSE,
  premium_since  TIMESTAMPTZ,
  member_since   TIMESTAMPTZ DEFAULT NOW(),
  cooking_skill  TEXT DEFAULT 'beginner'
                   CHECK (cooking_skill IN ('beginner', 'intermediate', 'advanced')),
  calorie_goal   INTEGER DEFAULT 2000,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.user_preferences (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  dietary_restrictions  TEXT[] DEFAULT '{}',
  cuisine_preferences   TEXT[] DEFAULT '{}',
  disliked_ingredients  TEXT[] DEFAULT '{}',
  max_cook_time         INTEGER DEFAULT 60,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RECIPES
-- ============================================================
CREATE TABLE public.recipes (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT,
  image_url        TEXT,
  calories         INTEGER,
  protein          INTEGER,
  carbs            INTEGER,
  fat              INTEGER,
  cook_time        INTEGER NOT NULL,
  prep_time        INTEGER DEFAULT 0,
  servings         INTEGER DEFAULT 2,
  difficulty       TEXT DEFAULT 'easy'
                     CHECK (difficulty IN ('easy', 'medium', 'hard')),
  cuisine          TEXT,
  tags             TEXT[] DEFAULT '{}',
  -- [{ "name": "Chicken", "amount": "200g" }]
  ingredients      JSONB NOT NULL DEFAULT '[]',
  -- [{ "step": 1, "instruction": "...", "duration": 5 }]
  steps            JSONB NOT NULL DEFAULT '[]',
  is_ai_generated  BOOLEAN DEFAULT FALSE,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recipes_tags ON public.recipes USING GIN (tags);
CREATE INDEX idx_recipes_cuisine ON public.recipes (cuisine);
CREATE INDEX idx_recipes_difficulty ON public.recipes (difficulty);

-- ============================================================
-- SAVED RECIPES (bookmarks)
-- ============================================================
CREATE TABLE public.saved_recipes (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipe_id  UUID REFERENCES public.recipes(id) ON DELETE CASCADE,
  saved_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, recipe_id)
);

-- ============================================================
-- MEAL PLANNER
-- ============================================================
CREATE TABLE public.meal_plans (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, week_start)
);

CREATE TABLE public.meal_plan_items (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meal_plan_id  UUID REFERENCES public.meal_plans(id) ON DELETE CASCADE,
  recipe_id     UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
  recipe_title  TEXT,
  meal_type     TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  -- 0 = Monday, 6 = Sunday
  day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  calories      INTEGER,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SHOPPING LIST
-- ============================================================
CREATE TABLE public.shopping_list_items (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  quantity    TEXT,
  unit        TEXT,
  category    TEXT DEFAULT 'Other',
  is_checked  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shopping_list_user ON public.shopping_list_items (user_id);

-- ============================================================
-- AI CHAT
-- ============================================================
CREATE TABLE public.ai_chat_sessions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           TEXT,
  recipe_context  JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.ai_chat_messages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id  UUID REFERENCES public.ai_chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session ON public.ai_chat_messages (session_id, created_at);

-- ============================================================
-- AI USAGE TRACKING (per day per user)
-- ============================================================
CREATE TABLE public.ai_usage (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  date                DATE NOT NULL DEFAULT CURRENT_DATE,
  recipes_count       INTEGER DEFAULT 0,
  meal_plans_count    INTEGER DEFAULT 0,
  scans_count         INTEGER DEFAULT 0,
  suggestions_count   INTEGER DEFAULT 0,
  ai_chat_count       INTEGER DEFAULT 0,
  UNIQUE (user_id, date)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_recipes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plan_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage              ENABLE ROW LEVEL SECURITY;

-- Users can only see/edit their own data
CREATE POLICY "own_profile"     ON public.profiles            FOR ALL USING (auth.uid() = id);
CREATE POLICY "own_prefs"       ON public.user_preferences    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_saved"       ON public.saved_recipes       FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_plans"       ON public.meal_plans          FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_shopping"    ON public.shopping_list_items FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_sessions"    ON public.ai_chat_sessions    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_usage"       ON public.ai_usage            FOR ALL USING (auth.uid() = user_id);

-- Recipes: everyone can read, only creator can modify
CREATE POLICY "read_recipes"    ON public.recipes FOR SELECT USING (true);
CREATE POLICY "own_recipes"     ON public.recipes FOR ALL   USING (auth.uid() = created_by);

-- meal_plan_items: accessible via meal_plan owner
CREATE POLICY "own_plan_items"  ON public.meal_plan_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.meal_plans mp
      WHERE mp.id = meal_plan_id AND mp.user_id = auth.uid()
    )
  );

CREATE POLICY "own_messages"    ON public.ai_chat_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_chat_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
  );

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP (Supabase trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- UPDATED_AT AUTO-UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at              BEFORE UPDATE ON public.profiles              FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER user_preferences_updated_at      BEFORE UPDATE ON public.user_preferences      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER shopping_list_items_updated_at   BEFORE UPDATE ON public.shopping_list_items   FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER ai_chat_sessions_updated_at      BEFORE UPDATE ON public.ai_chat_sessions      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RECIPE RATINGS (stars)
-- ============================================================
CREATE TABLE public.recipe_ratings (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipe_id  UUID REFERENCES public.recipes(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, recipe_id)
);

CREATE INDEX idx_recipe_ratings_recipe ON public.recipe_ratings (recipe_id);

-- denormalized aggregates so lists don't need a join
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0;
