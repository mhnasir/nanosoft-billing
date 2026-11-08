import pg from 'pg';

// numeric/bigint -> JS number, timestamp/date -> plain strings (no timezone shifting)
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1114, (v) => (v === null ? null : v.replace(' ', 'T')));
pg.types.setTypeParser(1082, (v) => v);

let pool = null;

function config() {
  const e = process.env;
  if (e.DATABASE_URL) return { connectionString: e.DATABASE_URL, max: 10 };
  return {
    host: e.PG_HOST || 'localhost',
    port: Number(e.PG_PORT) || 5432,
    database: e.PG_DATABASE || 'nvs',
    user: e.PG_USER || 'postgres',
    password: e.PG_PASSWORD || undefined,
    ssl: e.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 10,
    connectionTimeoutMillis: 8000,
  };
}

export function getPool() {
  if (!pool) {
    pool = new pg.Pool(config());
    pool.on('error', (err) => console.error('[pg] idle client error', err.message));
  }
  return pool;
}

export async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

/** Turn "@name" placeholders into $1,$2... so SQL stays readable. */
export function compile(text, params = {}) {
  const order = [];
  const values = [];
  const sqlText = text.replace(/@([A-Za-z_]\w*)/g, (_m, name) => {
    if (!(name in params)) throw new Error(`Missing SQL parameter @${name}`);
    let idx = order.indexOf(name);
    if (idx === -1) {
      order.push(name);
      values.push(params[name] === undefined ? null : params[name]);
      idx = order.length - 1;
    }
    return `$${idx + 1}`;
  });
  return { text: sqlText, values };
}

function runner(client) {
  const run = async (text, params) => {
    const c = compile(text, params);
    return client.query(c.text, c.values);
  };
  return {
    /** rows only */
    query: async (text, params) => (await run(text, params)).rows,
    /** { rows, rowCount } */
    run,
  };
}

export const query = (text, params) => runner(getPool()).query(text, params);
export const run = (text, params) => runner(getPool()).run(text, params);

/** Run fn(db) inside a transaction. db has query() and run(). */
export async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(runner(client));
    // DRY_RUN=1 exercises every write path but never keeps the data (used by tests / check scripts).
    await client.query(process.env.DRY_RUN === '1' ? 'ROLLBACK' : 'COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Recalculate supmast.balanceamt the way the old stored procedures did (opening + bill postings). */
export async function refreshBalance(db, supKey) {
  await db.query(
    `UPDATE supmast SET balanceamt = COALESCE(opnbal,0) +
       COALESCE((SELECT SUM(amount) FROM fatrans WHERE supkey=@s AND recpay02stat=0),0)
     WHERE supkey=@s`,
    { s: supKey },
  );
}
