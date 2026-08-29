import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase
    .from('talent_entries')
    .select('*, talent_profiles(*)')
    .eq('talent_name', '李飞飞')
    .limit(1);

  console.log('Result:', JSON.stringify(data?.[0]?.talent_profiles, null, 2));
}
check();
