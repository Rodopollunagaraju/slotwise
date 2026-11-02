import fs from 'fs';
import path from 'path';
import { db, getPool, isUsingMemoryDb, setUseMemoryDb } from '../config/database';

export async function runMigrations() {
  console.log('[Migration] Starting database migration...');
  const localPath = path.join(__dirname, 'schema.sql');
  const srcPath = path.join(process.cwd(), 'src/db/schema.sql');
  const schemaPath = fs.existsSync(localPath) ? localPath : srcPath;
  const schemaSql = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : '';

  if (isUsingMemoryDb()) {
    console.log('[Migration] Using in-memory database - schema initialized in memory.');
    return;
  }

  const pool = getPool();
  if (!pool) {
    console.log('[Migration] No pool available, running in memory.');
    return;
  }

  try {
    await pool.query(schemaSql);
    console.log('[Migration] Schema and PostgreSQL btree_gist exclusion constraints applied successfully!');
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || (err.errors && err.errors[0]?.code === 'ECONNREFUSED')) {
      console.warn('[Migration] PostgreSQL not running locally. Seamlessly falling back to in-memory engine.');
      setUseMemoryDb(true);
      return;
    }
    console.error('[Migration] Failed to execute schema.sql:', err.message);
    throw err;
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
