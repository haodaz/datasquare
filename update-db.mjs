import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres:0762Kaimen4526@db.qrmjiwbvqerdsrayqvpv.supabase.co:5432/postgres'
});
async function run() {
  await client.connect();
  try {
    // 1. Add imported column to talent_profiles
    await client.query(`
      ALTER TABLE public.talent_profiles 
      ADD COLUMN IF NOT EXISTS db_entity_id BIGINT;
    `);
    console.log('Added db_entity_id to talent_profiles');
    
    // 2. Add imported flag to talent_entries (just in case)
    await client.query(`
      ALTER TABLE public.talent_entries 
      ADD COLUMN IF NOT EXISTS imported_to_db BOOLEAN DEFAULT FALSE;
    `);
    console.log('Added imported_to_db to talent_entries');
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
