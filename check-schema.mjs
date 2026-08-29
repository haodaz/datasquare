import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres:0762Kaimen4526@db.qrmjiwbvqerdsrayqvpv.supabase.co:5432/postgres'
});
async function run() {
  await client.connect();
  try {
    const res = await client.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name IN ('talent_entries', 'talent_profiles', 'talent_db_entities');
    `);
    
    const tables = {};
    for (const row of res.rows) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push(row.column_name);
    }
    console.log(tables);
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
