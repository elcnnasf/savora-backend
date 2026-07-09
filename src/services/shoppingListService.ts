import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { AddItemInput, UpdateItemInput, AddBulkInput } from '../schemas/shoppingList';

export async function getShoppingList(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('shopping_list_items')
    .select('*')
    .eq('user_id', userId)
    .order('category', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new AppError(500, error.message);

  // Group by category
  const grouped: Record<string, typeof data> = {};
  for (const item of data ?? []) {
    const cat = item.category ?? 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  return { items: data ?? [], grouped };
}

export async function addItem(userId: string, input: AddItemInput) {
  const { data, error } = await supabaseAdmin
    .from('shopping_list_items')
    .insert({ ...input, user_id: userId })
    .select()
    .single();

  if (error) throw new AppError(500, error.message);
  return data;
}

export async function addBulkItems(userId: string, input: AddBulkInput) {
  const rows = input.items.map((item) => ({ ...item, user_id: userId }));

  const { data, error } = await supabaseAdmin
    .from('shopping_list_items')
    .insert(rows)
    .select();

  if (error) throw new AppError(500, error.message);
  return data;
}

export async function updateItem(userId: string, itemId: string, input: UpdateItemInput) {
  const { data, error } = await supabaseAdmin
    .from('shopping_list_items')
    .update(input)
    .eq('id', itemId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) throw new AppError(404, 'Item not found');
  return data;
}

export async function deleteItem(userId: string, itemId: string) {
  const { error } = await supabaseAdmin
    .from('shopping_list_items')
    .delete()
    .eq('id', itemId)
    .eq('user_id', userId);

  if (error) throw new AppError(500, error.message);
}

export async function clearChecked(userId: string) {
  const { error } = await supabaseAdmin
    .from('shopping_list_items')
    .delete()
    .eq('user_id', userId)
    .eq('is_checked', true);

  if (error) throw new AppError(500, error.message);
}

export async function clearAll(userId: string) {
  const { error } = await supabaseAdmin
    .from('shopping_list_items')
    .delete()
    .eq('user_id', userId);

  if (error) throw new AppError(500, error.message);
}

export async function toggleAll(userId: string, checked: boolean) {
  const { data, error } = await supabaseAdmin
    .from('shopping_list_items')
    .update({ is_checked: checked })
    .eq('user_id', userId)
    .select();

  if (error) throw new AppError(500, error.message);
  return data;
}
