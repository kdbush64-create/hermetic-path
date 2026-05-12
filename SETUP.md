# ∴ Hermetic Path — Setup Guide ∴

Step-by-step instructions to get the app deployed without touching `v64otd.com`.
Follow the steps in order. **Do not push to `main` until Step 9 (validation) is complete.**

---

## What you'll create

| Resource                          | Where               | Why                                                 |
|----------------------------------|---------------------|-----------------------------------------------------|
| `hermetic-path` GitHub repo       | github.com          | Source of truth for the code.                       |
| 2× KV namespaces                  | Cloudflare          | Store users + invites for dev and production.       |
| `CLOUDFLARE_API_TOKEN` secret     | GitHub repo         | Lets GitHub Actions deploy on every push.           |
| `CLOUDFLARE_ACCOUNT_ID` secret    | GitHub repo         | Tells the Action which CF account to deploy to.     |
| `ANTHROPIC_API_KEY` secret        | Cloudflare Worker   | Server-side calls to Claude. Never in the repo.     |
| `SESSION_SECRET` secret           | Cloudflare Worker   | Signs session cookies.                              |
| `ADMIN_EMAIL` variable            | Cloudflare Worker   | The first email allowed to bootstrap admin.         |
| `hermeticpath.v64otd.com` route   | Cloudflare DNS+Workers | Production traffic — added at the very end.       |

The Anthropic API key never enters this repository or this chat. It lives only in Cloudflare's encrypted secret store.

---

## Step 1 — Create the GitHub repo

In your open GitHub tab:

1. Go to https://github.com/new
2. **Repository name:** `hermetic-path`
3. **Description:** *(optional)* "The Hermetic Path — private esoteric study PWA"
4. Select **Private**.
5. **Do NOT** check "Add a README" / `.gitignore` / license — we already have those.
6. Click **Create repository**.
7. On the next page, copy the SSH or HTTPS clone URL. You'll use it in Step 2.

---

## Step 2 — Push the scaffold

On your computer, in a terminal:

```bash
# 1. Move into the hermetic-path folder I generated for you
cd /path/to/hermetic-path     # the folder Claude wrote to your outputs

# 2. Initialize git and make the first commit on main
git init -b main
git add .
git commit -m "Initial scaffold: worker + auth + UI"

# 3. Connect to GitHub (replace with your URL from Step 1)
git remote add origin https://github.com/<your-user>/hermetic-path.git
git push -u origin main

# 4. Create the dev branch and push it
git checkout -b dev
git push -u origin dev
```

After this, `main` and `dev` point to the same commit. **No divergence.** The Action will trigger on the dev push but will fail until secrets are set up — that's expected.

---

## Step 3 — Create Cloudflare KV namespaces

You need **four** KV namespaces total: users + invites, each in dev and production.

1. Cloudflare dashboard → **Workers & Pages** → **KV** (left sidebar).
2. Click **Create a namespace**.
3. Name it: `hermetic-users-dev`. Click **Add**.
4. Repeat for: `hermetic-invites-dev`, `hermetic-users-prod`, `hermetic-invites-prod`.
5. After creating each one, click into it and **copy its ID** (a 32-character hex string).

Open `wrangler.toml` in the repo and replace the four `REPLACE_WITH_*_KV_ID` placeholders with the correct IDs. Commit and push to `dev`:

```bash
git add wrangler.toml
git commit -m "Wire up KV namespace IDs"
git push origin dev
```

---

## Step 4 — Create a Cloudflare API token (for GitHub Actions)

1. Cloudflare dashboard → click your profile (top right) → **My Profile** → **API Tokens** → **Create Token**.
2. Use the **"Edit Cloudflare Workers"** template. Click **Use template**.
3. Account resources → **Include → your account**.
4. Zone resources → **Include → Specific zone → `v64otd.com`** *(needed later for the custom domain)*.
5. Click **Continue to summary** → **Create Token**.
6. **Copy the token now** — Cloudflare only shows it once.

Also grab your **Account ID**: go to **Workers & Pages** → it's shown on the right sidebar (32-char hex).

---

## Step 5 — Add GitHub Secrets

In your `hermetic-path` repo on GitHub:

1. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add two secrets:
   - Name: `CLOUDFLARE_API_TOKEN` — Value: the token from Step 4.
   - Name: `CLOUDFLARE_ACCOUNT_ID` — Value: your account ID.

That's it for GitHub.

---

## Step 6 — Create the dev Worker and set its secrets

The first `dev`-branch push will create the Worker automatically. If it hasn't run yet, re-run the workflow:

1. GitHub repo → **Actions** tab → click the latest run → **Re-run all jobs**.
2. Wait for green check.

Then in Cloudflare:

1. **Workers & Pages** → you should see `hermetic-path-dev`. Click it.
2. **Settings** → **Variables and Secrets**.
3. Click **Add** under **Variables** (plaintext):
   - Name: `ADMIN_EMAIL` — Value: the email **you** will use to bootstrap (case-insensitive).
4. Click **Add** under **Secrets** (encrypted):
   - Name: `ANTHROPIC_API_KEY` — Value: your real Anthropic key (`sk-ant-...`).
   - Name: `SESSION_SECRET` — Value: a long random string. Generate one any way you like — e.g., open a fresh terminal and run `openssl rand -base64 48` and paste the result.
5. After saving, click **Deployments** → **Redeploy** so the worker picks up the secrets. (Or just push any commit to `dev` again.)

The dev URL is now live at something like:

```
https://hermetic-path-dev.<your-account>.workers.dev
```

Cloudflare shows the exact URL on the worker's overview page.

---

## Step 7 — Bootstrap your admin account on dev

1. Open the dev URL in your browser (Android Chrome works fine — it's a PWA).
2. You should see **"Light the First Lamp"**.
3. Enter the **same** email you set as `ADMIN_EMAIL` in Step 6 and choose a strong password.
4. Click **Take the Key**. You're now signed in as admin.
5. Navigate to **Admin** → **Generate an invite** → optionally bind to an email → **Create invite**. Copy the code or the redemption link.
6. Share the code/link with each of the other 4 initiates. They open the link, fill in their email + password, and they're in.

> The bootstrap route automatically closes itself once any user exists. It cannot be reused.

---

## Step 8 — Smoke test on dev

While you're on the dev URL:

- [ ] Lock screen shows clock + a one-line transmission.
- [ ] Tap to enter → app loads.
- [ ] Daily Tutor → "Open the lesson" → text streams in.
- [ ] Affirmations → "Draw the lines" → list renders.
- [ ] Scripture → "John 1:1" → all four PaRDeS sections.
- [ ] Settings → toggle "Enable daily transmissions" → **Save settings** → success message.
- [ ] Sign out → log back in → still works.
- [ ] Open https://v64otd.com in a separate tab → it loads exactly as before. **Critical check.**

If everything looks right, continue.

---

## Step 9 — Production: set the same secrets on the prod worker

Production won't exist as a worker yet because we haven't pushed to `main`. To prepare:

1. In Cloudflare, **manually create an empty Worker named `hermetic-path`** so we can set its secrets before deploying:
   - **Workers & Pages** → **Create application** → **Workers** → **Create Worker** → name it `hermetic-path` → **Deploy** (it'll deploy a placeholder Hello World — we'll overwrite it).
2. Open `hermetic-path` → **Settings** → **Variables and Secrets**.
3. Add the same three secrets/variables as Step 6:
   - `ANTHROPIC_API_KEY` *(can be the same key as dev, or a different one)*
   - `SESSION_SECRET` *(use a **different** random value than dev — they should not match)*
   - `ADMIN_EMAIL` *(the same email you used for dev bootstrap)*

Confirm the KV namespace IDs for production in `wrangler.toml` are correct.

---

## Step 10 — Add the custom domain (no v64otd.com disturbance)

Still on the `hermetic-path` (production) Worker:

1. **Settings** → **Triggers** → **Add Custom Domain**.
2. Enter: `hermeticpath.v64otd.com` → **Add Custom Domain**.
3. Cloudflare will:
   - Create a new `AAAA` DNS record for the **subdomain only**.
   - Issue an SSL certificate within ~60 seconds.
4. **No redirect, no CNAME touched on `v64otd.com` itself.** The root domain is untouched.
5. While you wait, verify in **DNS** → records list that the only new entry is for `hermeticpath` (not for `@` or `www`).

---

## Step 11 — Promote dev → main

You've validated dev. v64otd.com still works. The custom domain is wired. Now we deploy production:

```bash
git checkout main
git merge dev --ff-only       # fast-forward; main and dev should be even
git push origin main
```

GitHub Actions runs `wrangler deploy --env production`, which uploads the same code to the `hermetic-path` worker, overwriting the placeholder Hello World.

Within a minute, https://hermeticpath.v64otd.com serves the app. Bootstrap again on the production URL (separate user store from dev) using your admin email.

---

## Step 12 — Final validation

- [ ] https://hermeticpath.v64otd.com → "Light the First Lamp" screen renders.
- [ ] You can bootstrap admin on production.
- [ ] https://v64otd.com → still loads exactly as before, unchanged.
- [ ] Generate one invite on prod, redeem it from a different browser → second user works.
- [ ] Lock screen, lessons, scripture, settings all functional.
- [ ] On Android Chrome, open the URL → menu → **Add to Home screen** → launches as standalone PWA.

If any of these fail, **do not panic** — the production worker is isolated. Roll back by pushing the previous commit, or by clicking **Rollback** on the worker's **Deployments** tab in Cloudflare.

---

## Adding more users later

Sign in as admin → **Admin** tab → **Create invite** → share code or link. Invites expire in 7 days and are single-use.

## Rotating the Anthropic key

Cloudflare → `hermetic-path` worker → **Settings** → **Variables and Secrets** → click the eye next to `ANTHROPIC_API_KEY` → **Edit** → paste new key → **Save**. No redeploy required.

## Resetting a user's password

Admin doesn't reset passwords directly (it would require knowing it). Instead, delete the user from the Admin panel, then issue a new invite for them.

---

## Troubleshooting

| Symptom                                                | Fix                                                                 |
|--------------------------------------------------------|---------------------------------------------------------------------|
| "Server is not fully configured" on first load         | One of `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `ADMIN_EMAIL`, or KV is missing. Re-check Step 6/9. |
| GitHub Action fails with "ETIMEDOUT" or "401"           | `CLOUDFLARE_API_TOKEN` is wrong or doesn't have Workers Edit scope. |
| Action says "no KV namespace bound"                     | KV IDs in `wrangler.toml` still say `REPLACE_WITH_...`. Edit and commit. |
| `hermeticpath.v64otd.com` returns "ERR_TOO_MANY_REDIRECTS" | The route pattern conflicts with another worker. Check **Workers & Pages → Domains & Routes** for duplicates. |
| Notifications don't fire on Android                    | Open the PWA at least once daily — Web Notifications only fire while the page (or its service worker) is active. |
