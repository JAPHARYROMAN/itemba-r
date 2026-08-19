# ITEMBA-R — Digital Ocean relaunch runbook

A from-scratch redeploy after the droplet was destroyed. The **app, schema, and
seed are all in this repo** — only the old database *data* is gone (no backup),
so this is a clean relaunch: a fresh DB with the seeded admin + org structure.

You run the steps below; the heavy lifting is one script
(`deploy/relaunch/deploy.sh`) that provisions Docker, generates fresh secrets on
the server, builds + starts the stack, applies migrations, seeds, and installs
nightly backups.

---

## 0. Prerequisites
- A Digital Ocean account in good standing (payment sorted).
- Access to DNS for **itembagrouptz.com** (your registrar or DO's DNS).
- An SSH key you can use to log into the droplet.

---

## 1. Create the droplet
DO console → **Create → Droplet**:
- **Image:** Ubuntu 22.04 (LTS) x64
- **Size:** Basic / Regular — **8 GB RAM / 4 vCPU** recommended (~$48/mo). 4 GB
  works as a minimum (the script adds swap so the Next.js builds don't OOM), but
  8 GB is comfortable for 7 running containers.
- **Region:** Frankfurt (FRA1) or Bangalore (BLR1) — lowest latency to Tanzania.
- **Authentication:** your SSH key.
- Create, and note the **public IP**.

---

## 2. Point DNS at the droplet
Create these **A records**, all → the droplet IP:

| Host | Type | Value |
|------|------|-------|
| `@` (root) | A | DROPLET_IP |
| `www` | A | DROPLET_IP |
| `app` | A | DROPLET_IP |
| `api` | A | DROPLET_IP |

Caddy can only issue HTTPS certificates once these resolve, so do this **before**
(or right after) running the script and give it a few minutes to propagate.

---

## 3. Get the code onto the droplet (private repo)
SSH in: `ssh root@DROPLET_IP`, then authenticate git for the private repo — pick one:

**Deploy key (recommended):**
```bash
apt-get update -y && apt-get install -y git
ssh-keygen -t ed25519 -f ~/.ssh/itemba_deploy -N "" -C "droplet-deploy"
cat ~/.ssh/itemba_deploy.pub
# Add that key at: GitHub → repo Settings → Deploy keys → Add (read-only is fine)
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/itemba_deploy
EOF
git clone git@github.com:JAPHARYROMAN/itemba-r.git /opt/itemba-r
```

**Or a Personal Access Token:**
```bash
apt-get update -y && apt-get install -y git
git clone https://<YOUR_PAT>@github.com/JAPHARYROMAN/itemba-r.git /opt/itemba-r
```

---

## 4. Run the relaunch script
```bash
cd /opt/itemba-r
DOMAIN=itembagrouptz.com bash deploy/relaunch/deploy.sh
```
It will: install Docker, add swap, generate `.env.production` with **fresh secrets**, build the
images (one at a time), start the stack, wait for the backend to go healthy
(migrations apply automatically), run the seed, and install a nightly backup cron.
First run takes ~10–20 min (image builds).

---

## 5. Verify
```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps          # all healthy
curl -fsS https://api.itembagrouptz.com/api/v1/health       # {"status":"ok",...}
```
Then open **https://app.itembagrouptz.com** and log in:
- `admin@itembagrouptz.com`
- Password: read `SEED_ADMIN_PASSWORD` from `/opt/itemba-r/.env.production`

If HTTPS isn't ready yet, wait for DNS to propagate (Caddy retries automatically);
check `docker compose --env-file .env.production -f docker-compose.production.yml logs -f caddy`.

---

## 6. Immediately after go-live
1. **Change the admin password** (and the seeded email if you want) in the UI.
2. **Back up `/opt/itemba-r/.env.production`** to a password manager — those secrets cannot be
   regenerated without invalidating sessions/encryption.
3. Confirm backups: `ls -la /opt/itemba-backups` (nightly 02:30 UTC, 14-day retention).
   Consider shipping them off-box (DO Spaces / `rclone`) so a future droplet loss
   doesn't lose data again.
4. Optional: fill SMTP + mobile-money keys in `.env.production`, then
   `docker compose --env-file .env.production -f docker-compose.production.yml up -d` to apply.

---

## Operations cheatsheet
```bash
cd /opt/itemba-r
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.production.yml restart backend
git pull && bash deploy/relaunch/deploy.sh     # update to latest main + rebuild
/usr/local/bin/itemba-backup.sh                # backup on demand
```
Full reference: `docs/admin/deployment-operations-guide.md`.

---

## 7. Deploying from GitHub (CD workflow)

`.github/workflows/deploy-production.yml` — **Actions → Deploy — Production → Run
workflow**. Manual only: a merge to `main` cannot reach the live app on its own.

### One-time setup

Repo **Settings → Secrets and variables → Actions**:

| Secret | What it is |
|---|---|
| `DEPLOY_HOST` | Droplet IP or hostname |
| `DEPLOY_USER` | SSH user on the droplet |
| `DEPLOY_SSH_KEY` | Private key, full PEM including header/footer lines |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan <DROPLET_IP>` |
| `DEPLOY_DOMAIN` | e.g. `itembagrouptz.com` |

Generate a key **for this purpose only**, so it can be revoked without touching
your own access:

```bash
ssh-keygen -t ed25519 -f itemba-deploy -C "github-actions-deploy" -N ""
ssh-copy-id -i itemba-deploy.pub <user>@<droplet-ip>
ssh-keyscan <droplet-ip>            # paste into DEPLOY_KNOWN_HOSTS
```

`DEPLOY_KNOWN_HOSTS` is required rather than optional. The alternative,
`ssh-keyscan` at deploy time, trusts whatever answers on the night — on a channel
that carries a key with write access to production, that hands a
man-in-the-middle a shell.

Then **Settings → Environments → production** and add yourself as a required
reviewer. That is the real approval gate; the typed confirmation phrase in the
workflow only stops an accidental click, and anything enforced inside the
workflow file can be edited in a branch.

### What it refuses to do

- Deploy a commit that is not an ancestor of `origin/main` — production never runs
  code no PR gated.
- Deploy a commit whose CI run is anything other than `success`. Queued, running,
  cancelled and failed are all refused.
- Run at all without both `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`.
- Run concurrently with itself.

### What it does not decide for you

**It re-runs the seed**, because `deploy.sh` does. The seed full-replaces role
permissions, so any hand-tuned production role is reset on every deploy. If that
becomes a problem, the fix is a `SKIP_SEED` guard in `deploy.sh`, not a change
here.

**It does not enable Msaidizi.** The verify step prints `MSAIDIZI_ENABLED` and
`MSAIDIZI_WRITE_MODE` so a drift toward "on" is visible in the run log, but
turning the agent on stays a deliberate edit to `/opt/itemba-r/.env.production`
followed by `docker compose --env-file .env.production -f
docker-compose.production.yml up -d backend`. A plain `docker restart` does not
re-read env.
