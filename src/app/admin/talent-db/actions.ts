'use server';

import { supabase } from '@/lib/supabase/client';
import { TalentDBEntity } from '@/types/talent';

export async function getTalentEntries(search?: string, page = 1, pageSize = 20) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('talent_db_entities')
    .select('*', { count: 'exact' });

  if (search) {
    query = query.or(`name.ilike.%${search}%,name_en.ilike.%${search}%,work_current.ilike.%${search}%`);
  }

  query = query.order('id', { ascending: false });
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) {
    console.error('getTalentEntries Error:', error);
    throw new Error(error.message);
  }

  return {
    data: (data || []) as TalentDBEntity[],
    total: count || 0,
  };
}

export async function getTalentDetail(id: number) {
  const { data, error } = await supabase
    .from('talent_db_entities')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('getTalentDetail Error:', error);
    throw new Error(error.message);
  }

  return data as TalentDBEntity;
}

export async function updateTalentProfile(profileId: number, updates: Partial<TalentDBEntity>) {
  // Ensure we don't accidentally update read-only fields
  const cleanUpdates = { ...updates, updated_at: new Date().toISOString() };
  delete cleanUpdates.id;
  delete cleanUpdates.source_journal_id;
  delete cleanUpdates.created_at;

  const { data, error } = await supabase
    .from('talent_db_entities')
    .update(cleanUpdates)
    .eq('id', profileId)
    .select()
    .single();

  if (error) {
    console.error('updateTalentProfile Error:', error);
    throw new Error(error.message);
  }

  return data as TalentDBEntity;
}

export async function deleteTalentEntry(id: number) {
  const { error } = await supabase
    .from('talent_db_entities')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('deleteTalentEntry Error:', error);
    throw new Error(error.message);
  }

  return true;
}
