// Create (or reset the password of) a login user in usermaster.
//   npm run create-user -- <username> <password>
import 'dotenv/config';
import pg from 'pg';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: npm run create-user -- <username> <password>');
  process.exit(1);
}
if (username.length > 50 || password.length > 50) {
  console.error('User name and password must be 50 characters or less.');
  process.exit(1);
}

const e = process.env;
const client = new pg.Client(
  e.DATABASE_URL
    ? { connectionString: e.DATABASE_URL }
    : { host: e.PG_HOST || 'localhost', port: Number(e.PG_PORT) || 5432, database: e.PG_DATABASE || 'nvs', user: e.PG_USER || 'postgres', password: e.PG_PASSWORD || undefined },
);
await client.connect();
try {
  const found = await client.query('SELECT userkey FROM usermaster WHERE lower(username)=lower($1) LIMIT 1', [username]);
  if (found.rows[0]) {
    await client.query('UPDATE usermaster SET pass=$2 WHERE userkey=$1', [found.rows[0].userkey, password]);
    console.log(`Password updated for user "${username}".`);
  } else {
    await client.query('INSERT INTO usermaster(username, pass, stat) VALUES ($1,$2,0)', [username, password]);
    console.log(`User "${username}" created.`);
  }
} finally {
  await client.end();
}
