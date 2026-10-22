// Shared Postgres connection pool (works with Neon / Supabase / Vercel Postgres).
// Set the DATABASE_URL env var in your Vercel project settings.
const { Pool } = require('pg');

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres providers require SSL.
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

module.exports = { getPool };