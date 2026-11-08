// Creates .env from .env.example with a fresh random JWT_SECRET (only if .env is missing).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  console.log('.env already exists - left untouched.');
  process.exit(0);
}
const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const secret = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(envFile, example.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`));
console.log('Created .env - open it and set DB_PASSWORD (and DB_INSTANCE / DB_PORT if different).');
