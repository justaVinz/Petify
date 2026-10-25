import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://virony:virony@localhost:5432/petify',
  max: 10,
});
