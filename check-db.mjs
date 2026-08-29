import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  console.log('Checking talent_db_entities...');
  const { data, error } = await supabase.from('talent_db_entities').select('*').limit(1);
  if (error) {
    console.error('Error fetching talent_db_entities:', error);
  } else {
    console.log('talent_db_entities exists. Data:', data);
  }
}
check();
