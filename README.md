# NanoSoft Billing

React (Vite + TypeScript) front end with a Node/Express API on **PostgreSQL**. It is a port of the VB6 NVS billing system; release 0.2 covers the core billing screens (see `docs/SCREEN-MAP.md`). SQL Server is only needed once, to export the old data.

## First-time setup on the shop PC

The database runs in Docker, laid out like `college-portal-app` (Postgres 18.1, data under `.tmp/dev/pgdata`). It is a **separate container on port 5434**, so `college-portal-app` (port 5433) and its `compose:clean` never touch billing data.

1. Have **Docker Desktop** and **Node.js LTS** installed.
2. Double-click **setup.cmd** (installs packages, creates `.env`). The defaults in `.env` already match the Docker database; change `PG_PASSWORD` (and the same value is picked up by Docker) before real use.
3. Start the database: `docker compose up -d db` (or `npm run compose:db`).
4. Create the tables: `npm run db:init`.
5. **Bring over the old data (one time):**
   1. Run **export-from-mssql.cmd**. It asks for the SQL Server instance (`.\SQLEXPRESS`), database (`NVS2026`) and the `sa` password (leave empty to use your Windows login) and writes plain files into the `migrate` folder using `bcp`, which ships with SQL Server.
   2. Run `npm run import`. It loads every table in one transaction, keeps the original key numbers, and checks the row counts against SQL Server. If anything does not match it stops and changes nothing. Run `npm run import -- --replace` to redo it after a fresh export.
6. Run the app, either way:
   - **start.cmd** -> http://localhost:3000 (Node on the PC), or
   - `docker compose up -d --build` -> http://localhost:3000 (the app in a container too; `docker compose run --rm app node scripts/import-mssql.js` runs the import inside it).
7. Other PCs on the LAN use `http://<this-pc-name>:3000` (allow port 3000 in Windows Firewall). Optional: right-click **install-autostart.cmd** -> Run as administrator to start the Node app with Windows (not needed with the Docker app, which restarts with Docker).

`npm run compose:clean` stops the stack and **deletes the billing database** (`.tmp`). Take a backup first: `docker compose exec db pg_dump -U postgres nvs > backup.sql`.

No Docker? Install PostgreSQL for Windows instead, set `PG_PORT=5432` and your password in `.env`, and skip step 3.

Sign in with an existing user from the VB6 app (it is read from the imported `usermaster` / `staffmast` tables).
Health check: http://localhost:3000/api/health tells you whether PostgreSQL is reachable and why not.

## Development

```
npm install
npm run init-env
npm run db:init
npm run dev:server     # API on :3000
npm run dev:client     # Vite on :5173 (proxies /api)
npm run build          # production bundle into dist/
TEST_PG_URL=postgres://postgres:pw@localhost:5432/nvs_test npm test   # database tests (wipes that database!)
```

## Notes

- The ledger rules of the old stored procedures (`InsUp_Bill01`, `INSUP_Bill02`, `INSUP_RECPAY02`) now live in `server/routes/bills.js` and `receipts.js`: a customer bill debits the party in `fatrans`, a supplier bill credits it, receipts/payments post with their discount.
- Table and column names are the same as in SQL Server (stored lower-case by PostgreSQL), so the old reports and SQL are easy to port.
- The VB6 app stores passwords in plain text and so does this login (it has to match them). Hash them before exposing the app beyond the LAN.
- `.env` holds the database password; it is not part of the source and must not be shared.
- **Back up** before first real use (see the `pg_dump` line above). Compare a few ledgers and balances with the VB6 app after the import.
