import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres:0762Kaimen4526@db.qrmjiwbvqerdsrayqvpv.supabase.co:5432/postgres'
});
async function run() {
  await client.connect();
  try {
    await client.query(`
      ALTER TABLE public.talent_db_entities 
      ADD COLUMN IF NOT EXISTS educations JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS work_experiences JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS awards JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS patents JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS papers JSONB DEFAULT '[]'::jsonb;
    `);
    console.log('Added nested entity columns to talent_db_entities');
    await client.query(`NOTIFY pgrst, 'reload schema';`);
    console.log('Schema reloaded');
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
