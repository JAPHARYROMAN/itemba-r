# Fuel Grid on the ITEMBA-R Droplet

ITEMBA-R owns the droplet's only Caddy container. Fuel Grid is deployed from
its own repository with `deploy/docker-compose.shared-droplet.yml` and joins the
external `itemba_shared_edge` network.

Only these containers use the shared network:

- `itemba_r_caddy_prod`
- Fuel Grid web, aliased as `fuelgrid-web`
- Fuel Grid API, aliased as `fuelgrid-api`

ITEMBA-R's backend, frontend, website, Postgres, and Redis stay on
`itemba_network`. Fuel Grid's Postgres and Redis stay on its private network.

## Required DNS

Point both records to the same droplet IP used by ITEMBA-R:

- `fuelgrid.itembagrouptz.com`
- `api.fuelgrid.itembagrouptz.com`

## ITEMBA-R production environment

The relaunch script adds these non-secret defaults to an older
`.env.production` without replacing existing values:

```dotenv
SHARED_EDGE_NETWORK=itemba_shared_edge
FUELGRID_APP_HOST=fuelgrid.itembagrouptz.com
FUELGRID_API_HOST=api.fuelgrid.itembagrouptz.com
FUELGRID_APP_URL=https://fuelgrid.itembagrouptz.com
FUELGRID_HEALTH_URL=https://api.fuelgrid.itembagrouptz.com/readyz
```

## Deployment order

1. Deploy ITEMBA-R so Caddy joins the shared edge network and knows the two
   Fuel Grid hostnames.
2. Deploy Fuel Grid's shared-droplet stack.
3. Verify all four public health endpoints.

Fuel Grid may be down or absent without preventing ITEMBA-R from starting.
Caddy returns a gateway error only for Fuel Grid hostnames until their upstream
containers are available.

```bash
curl -fsS https://app.itembagrouptz.com/api/health
curl -fsS https://api.itembagrouptz.com/api/v1/health/ready
curl -fsS https://fuelgrid.itembagrouptz.com/api/health
curl -fsS https://api.fuelgrid.itembagrouptz.com/readyz
```

Fuel Grid remains independently authenticated and stores no data in ITEMBA-R
during this integration stage.
