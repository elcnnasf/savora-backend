-- Calorie Counter feature (Premium/Pro only)
-- Run this once in the Supabase SQL Editor.
-- Adds the daily-usage counter column for /ai/analyze-calories.

alter table public.ai_usage
  add column if not exists calories_count integer not null default 0;
