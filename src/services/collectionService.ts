import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';

/** Owns-or-404 guard: returns the collection row or throws. */
async function requireOwnedCollection(userId: string, collectionId: string) {
  const { data, error } = await supabaseAdmin
    .from('collections')
    .select('*')
    .eq('id', collectionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new AppError(500, error.message);
  if (!data) throw new AppError(404, 'Collection not found');
  return data;
}

/** List the user's collections with a recipe count and up to 4 cover images. */
export async function listCollections(userId: string) {
  const { data: cols, error } = await supabaseAdmin
    .from('collections')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new AppError(500, error.message);
  if (!cols || cols.length === 0) return [];

  const ids = cols.map((c: any) => c.id);
  const { data: links, error: linkErr } = await supabaseAdmin
    .from('collection_recipes')
    .select('collection_id, added_at, recipes(image_url)')
    .in('collection_id', ids)
    .order('added_at', { ascending: false });
  if (linkErr) throw new AppError(500, linkErr.message);

  const byCol: Record<string, { count: number; covers: string[] }> = {};
  for (const row of links ?? []) {
    const cid = (row as any).collection_id;
    const img = (row as any).recipes?.image_url;
    if (!byCol[cid]) byCol[cid] = { count: 0, covers: [] };
    byCol[cid].count += 1;
    if (img && byCol[cid].covers.length < 4) byCol[cid].covers.push(img);
  }

  return cols.map((c: any) => ({
    ...c,
    recipe_count: byCol[c.id]?.count ?? 0,
    covers:       byCol[c.id]?.covers ?? [],
  }));
}

export async function createCollection(
  userId: string,
  input: { name: string; emoji?: string; color?: string },
) {
  const { data, error } = await supabaseAdmin
    .from('collections')
    .insert({ user_id: userId, name: input.name, emoji: input.emoji, color: input.color })
    .select()
    .single();
  if (error) throw new AppError(500, error.message);
  return { ...data, recipe_count: 0, covers: [] };
}

export async function renameCollection(
  userId: string,
  collectionId: string,
  input: { name?: string; emoji?: string; color?: string },
) {
  await requireOwnedCollection(userId, collectionId);
  const patch: Record<string, any> = {};
  if (input.name  !== undefined) patch.name  = input.name;
  if (input.emoji !== undefined) patch.emoji = input.emoji;
  if (input.color !== undefined) patch.color = input.color;
  const { data, error } = await supabaseAdmin
    .from('collections')
    .update(patch)
    .eq('id', collectionId)
    .select()
    .single();
  if (error) throw new AppError(500, error.message);
  return data;
}

export async function deleteCollection(userId: string, collectionId: string) {
  await requireOwnedCollection(userId, collectionId);
  const { error } = await supabaseAdmin
    .from('collections')
    .delete()
    .eq('id', collectionId);
  if (error) throw new AppError(500, error.message);
}

/** Add a recipe to a collection. Also bookmarks it so it shows under Saved. */
export async function addRecipeToCollection(userId: string, collectionId: string, recipeId: string) {
  await requireOwnedCollection(userId, collectionId);

  // keep Saved and collections consistent — a categorised recipe is a saved one
  await supabaseAdmin
    .from('saved_recipes')
    .insert({ user_id: userId, recipe_id: recipeId })
    .then(({ error }) => {
      if (error && error.code !== '23505') throw new AppError(500, error.message);
    });

  const { error } = await supabaseAdmin
    .from('collection_recipes')
    .insert({ collection_id: collectionId, recipe_id: recipeId });
  if (error && error.code !== '23505') throw new AppError(500, error.message);
}

export async function removeRecipeFromCollection(userId: string, collectionId: string, recipeId: string) {
  await requireOwnedCollection(userId, collectionId);
  const { error } = await supabaseAdmin
    .from('collection_recipes')
    .delete()
    .eq('collection_id', collectionId)
    .eq('recipe_id', recipeId);
  if (error) throw new AppError(500, error.message);
}

/** Recipes inside one collection (for the collection detail / filtered view). */
export async function getCollectionRecipes(userId: string, collectionId: string) {
  const collection = await requireOwnedCollection(userId, collectionId);
  const { data, error } = await supabaseAdmin
    .from('collection_recipes')
    .select('added_at, recipes(*)')
    .eq('collection_id', collectionId)
    .order('added_at', { ascending: false });
  if (error) throw new AppError(500, error.message);
  const recipes = (data ?? []).map((row: any) => ({ ...row.recipes, added_at: row.added_at }));
  return { collection, recipes };
}

/** Which of the user's collections already contain a given recipe. */
export async function getCollectionIdsForRecipe(userId: string, recipeId: string): Promise<string[]> {
  const { data: cols, error } = await supabaseAdmin
    .from('collections')
    .select('id')
    .eq('user_id', userId);
  if (error) throw new AppError(500, error.message);
  const ids = (cols ?? []).map((c: any) => c.id);
  if (ids.length === 0) return [];

  const { data, error: linkErr } = await supabaseAdmin
    .from('collection_recipes')
    .select('collection_id')
    .eq('recipe_id', recipeId)
    .in('collection_id', ids);
  if (linkErr) throw new AppError(500, linkErr.message);
  return (data ?? []).map((r: any) => r.collection_id);
}

/** Turn on sharing for a collection (idempotent) and return its share slug. */
export async function shareCollection(userId: string, collectionId: string): Promise<string> {
  const collection = await requireOwnedCollection(userId, collectionId);
  if (collection.share_id) return collection.share_id;

  const shareId = randomBytes(9).toString('base64url'); // ~12 url-safe chars
  const { error } = await supabaseAdmin
    .from('collections')
    .update({ share_id: shareId })
    .eq('id', collectionId);
  if (error) throw new AppError(500, error.message);
  return shareId;
}

/** Public read of a shared collection by its share slug (no auth). */
export async function getSharedCollection(shareId: string) {
  const { data: collection, error } = await supabaseAdmin
    .from('collections')
    .select('id, name, emoji, color, share_id')
    .eq('share_id', shareId)
    .maybeSingle();
  if (error) throw new AppError(500, error.message);
  if (!collection) throw new AppError(404, 'Shared collection not found');

  const { data, error: linkErr } = await supabaseAdmin
    .from('collection_recipes')
    .select('added_at, recipes(*)')
    .eq('collection_id', collection.id)
    .order('added_at', { ascending: false });
  if (linkErr) throw new AppError(500, linkErr.message);
  const recipes = (data ?? []).map((row: any) => row.recipes);
  return { collection, recipes };
}
