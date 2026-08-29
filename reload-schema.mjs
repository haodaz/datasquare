import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres:0762Kaimen4526@db.qrmjiwbvqerdsrayqvpv.supabase.co:5432/postgres'
});
async function run() {
  await client.connect();
  try {
    await client.query(`NOTIFY pgrst, 'reload schema';`);
    console.log('Schema reloaded');
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
