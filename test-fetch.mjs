import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const mcpIds = [1]; // Try with a dummy ID, or just see if the query fails entirely
  const { data: profiles, error: fetchErr } = await supabase
      .from('talent_profiles')
      .select('talent_entry_id, structured_data')
      .in('talent_entry_id', mcpIds);

  if (fetchErr) {
    console.error('Error fetching talent_profiles:', fetchErr);
  } else {
    console.log('Success, data length:', profiles?.length);
  }
}
check();
