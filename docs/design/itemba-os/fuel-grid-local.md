# Fuel Grid local connection

The connected application is the sibling `fuelGrid os` repository, not ITEMBA-R's Fuel Reporting module. Fuel Grid uses its own Go API, PostgreSQL database, Redis service and account/session.

Local topology:

| Component | Address |
| --- | --- |
| ITEMBA OS | `http://localhost:3009` |
| ITEMBA-R API | `http://localhost:3014` |
| Fuel Grid web | `http://localhost:3000/login` |
| Fuel Grid API readiness | `http://127.0.0.1:8090/readyz` |
| Fuel Grid PostgreSQL | Existing `fuelgrid-postgres` container, port `5440` |
| Fuel Grid Redis | `fuelgrid-os-redis-local`, loopback port `6382` |

Redis has its own container because ITEMBA-R already uses port 6379. The original stopped `fuelgrid-redis` container and its volume remain intact. Do not start it on the occupied port.

The ignored `frontend/.env.local` selects the real launch and readiness endpoints with `FUELGRID_APP_URL` and `FUELGRID_HEALTH_URL`. Production requires its own addresses and process management; this local connection is not a deployment.

## Starting after a machine restart

Start Docker Desktop, then run:

```powershell
docker start fuelgrid-postgres fuelgrid-os-redis-local
./scripts/start-fuel-grid-api.ps1
```

The helper reads only the existing database/password-pepper and session configuration from Fuel Grid's `.env`, uses the dedicated Redis instance and starts the Go API on loopback. It does not reseed users or replace passwords. Check `/readyz` before launching another API process. API logs are `%TEMP%/itemba-os-fuelgrid-api.log` and `.err.log`.

In the Fuel Grid repository, start its web app:

```powershell
$env:API_ORIGIN = 'http://127.0.0.1:8090'
$env:NEXT_PUBLIC_API_URL = 'http://localhost:8090'
pnpm --filter @fuelgrid/web dev
```

Fuel Grid requires its existing dependencies (`pnpm install --frozen-lockfile`) and Go migrations. On 17 September 2026, the local schema was upgraded from 102 to 114 using its checked-in migrations. Before that update, a custom-format database backup was saved at `%LOCALAPPDATA%/ItembaOS/backups/fuelgrid-before-migrations-20260917.dump`. No reset or seed command was run.

## Sign-in and return

Open Fuel Grid from the ITEMBA OS desktop or dock, review its service status, and choose **Open Fuel Grid**. Its own tenant/email/password login opens in another tab. Switch back to the ITEMBA OS tab to return; **Back to Apps** and the ITEMBA-R dock button retain the underlying ERP document. Credentials and tokens are not transferred between the two applications.
