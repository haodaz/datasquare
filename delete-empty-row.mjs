import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres:0762Kaimen4526@db.qrmjiwbvqerdsrayqvpv.supabase.co:5432/postgres'
});
async function run() {
  await client.connect();
  try {
    await client.query(`DELETE FROM public.talent_db_entities WHERE id = 1;`);
    await client.query(`UPDATE public.talent_entries SET imported_to_db = false WHERE id = 2;`);
    await client.query(`UPDATE public.talent_profiles SET db_entity_id = null WHERE talent_entry_id = 2;`);
    console.log('Deleted empty row and reset flags');
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
