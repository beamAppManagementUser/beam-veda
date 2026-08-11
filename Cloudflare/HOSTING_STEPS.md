# Deploying Beam Veda to Cloudflare — Step by Step

Everything here stays on Cloudflare's free tier. You'll need about 15-20 minutes and a computer with the project folder on it.

## 1. Create a free Cloudflare account
Go to [cloudflare.com](https://cloudflare.com) and sign up if you haven't already.

## 2. Install the tools and log in
From inside the project folder, run:
```bash
npm install
npx wrangler login
```
This opens a browser tab to connect Wrangler (Cloudflare's command-line tool) to your account.

## 3. Create the database
```bash
npx wrangler d1 create beam-veda-db
```
This prints a `database_id`. Copy that value into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## 4. Create the file storage bucket
```bash
npx wrangler r2 bucket create beam-veda-photos
```
This is where photos, company logos, and backups will be stored.

## 5. Load the database schema
```bash
npm run db:init:remote
```
This creates all the tables (companies, users, inward/outward entries, etc.) in your real Cloudflare database.

## 6. Set your secrets
```bash
npx wrangler secret put SESSION_SECRET
```
Paste any long random string when prompted — this signs login sessions.

```bash
npx wrangler secret put RESEND_API_KEY
```
Needed for the "Email Report" feature. Get a free API key from [resend.com](https://resend.com) (100 emails/day free).

## 7. Deploy
```bash
npm run deploy
```
Wrangler prints a live URL like `beam-veda.<yourname>.workers.dev` — that's your working app.

## 8. Log in and change the root password immediately
Go to the deployed URL and log in as root with:
- User ID: `Admin`
- Password: `Anupamaji#1`

**Change this password right away** — it's been shared in this chat, so treat it as already public. To change it: go to **My Account**, first save your security question answers (Favourite Colour / Favourite Place) under "Security Questions," then use "Change Password" (which requires those answers, by design).

## 9. (Recommended) Set up rate limiting in the Cloudflare dashboard
The app has its own IP-level login throttle built in (blocks a source after 20 failed attempts in 15 minutes, across any account), but that's a backstop, not real edge protection. For that: **Cloudflare dashboard → Security → WAF → Rate limiting rules** — add a rule on `/api/auth/login` (e.g. block after 10 requests/minute from one IP). Free tier covers a basic rule.

## 10. (Optional) Alerts for failed scheduled backups
Set `ALERT_EMAIL` in `wrangler.toml` (or as a var in the dashboard) to your own email. If the weekly backup or auto-purge job fails, you'll get an email instead of finding out only if you happen to check the Backups tab.

## 11. (Later, once you own the domain) Attach beamveda.com
In the Cloudflare dashboard: **Workers & Pages → your worker → Custom Domains → Add**. No code change needed — this also automatically shortens every company's signup link, since those links are built from wherever the app is actually running.

---

## Uploading to Git first (recommended)
If you want the code in a Git repository before deploying (recommended so you have version history):
```bash
cd beam-veda
git init
git add .
git commit -m "Initial commit — Beam Veda"
git remote add origin <your empty GitHub/GitLab repo URL>
git push -u origin main
```
Then Cloudflare can optionally deploy automatically from that repo (Workers & Pages → Create → Connect to Git) instead of running `npm run deploy` by hand each time — either approach works.

## Running the automated tests yourself
Before or after deploying, you can re-verify the app's logic at any time:
```bash
node test/run.mjs
```
Should print `51 passed, 0 failed` (or higher, as more get added).
