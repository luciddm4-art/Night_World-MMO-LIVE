# Backups and restore

Everything players own (accounts, characters, inventories, bans) lives in one Postgres table on Neon.

## What protects it

| Layer | Covers | Needs you? |
|---|---|---|
| **Neon instant restore** | Mistakes in the last **6 hours** (Free plan) | Only when something goes wrong |
| **Nightly encrypted export** (`.github/workflows/backup.yml`) | The last 30 days, one file per night | One-time setup below |
| **Manual export** (`tools/export.mjs`) | Whenever you want a copy on your own device | Optional |

## One-time setup of the nightly backup (phone-friendly)

1. Open your repo on github.com → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Name `DATABASE_URL`, value = your Neon connection string (the same one you put in Render). **Add secret.**
3. New secret again: name `BACKUP_PASSPHRASE`, value = a long random phrase (20+ characters). **Write it down somewhere
   safe — without it the backups cannot be opened.** The files are public-repo artifacts, so the passphrase is what
   protects the password hashes inside.
4. **Actions** tab → **Nightly backup** → **Run workflow** to test it. A green run with an artifact called
   `nwo-backup-encrypted` means it works. After that it runs by itself every night.

## If the nightly run is red

- **`getaddrinfo EAI_AGAIN base`**: the `DATABASE_URL` secret isn't a clean connection string. It must be only the
  `postgresql://…` address. (The tools now cut away `psql '…'`, quotes and `DATABASE_URL=` automatically, but a value that
  has no `postgresql://` in it at all, or that shows `***` instead of the password, can't work.) Fix: Settings → Secrets and
  variables → Actions → tap the pencil next to `DATABASE_URL` → paste again → **Update secret** → re-run the workflow.
- **`password authentication failed`**: the password in the string is wrong or masked. In Neon use **Connect** and tick
  **Show password** before copying.
- **Skipped: add the DATABASE_URL and BACKUP_PASSPHRASE secrets**: one of the two secrets is missing or has the wrong name.

## Restore option 1 — something broke in the last 6 hours (Neon)

1. console.neon.tech → your project → **Backup & Restore** (labelled "Instant restore" on some screens).
2. Pick the **time before the problem** and look at the data on a temporary branch first if you can.
3. Restore. Neon keeps a backup branch of the state just before the restore, so you can undo it.
4. Restart the Render service (**Manual Deploy → Restart**) so the server reloads the data.

## Restore option 2 — from a nightly file

1. Actions → a **Nightly backup** run → download `nwo-backup-encrypted` (a zip with `nwo-backup.enc`).
2. On a computer: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in nwo-backup.enc -out backup.json` (asks for the passphrase).
3. `DATABASE_URL="postgresql://…" node tools/import.mjs backup.json`
   - default: accounts that already exist are **kept** (only missing ones are added), so it is safe on a live database
   - `--overwrite`: the file replaces existing accounts (use it to roll players back)
4. Restart the Render service so the server reloads the data from the database.

## Manual export

`DATABASE_URL="postgresql://…" node tools/export.mjs` writes `nwo-backup-DATE.json`. It contains password hashes:
keep it private, never commit it (it is git-ignored).

## Practice once

A backup you've never restored is a hope, not a backup. After setting up, run the import against a throwaway Neon
branch once so you know the steps work. `test/backup.test.js` proves export → import round-trips accounts, characters
and bans, and that a wrong or damaged file is refused before anything is written.
