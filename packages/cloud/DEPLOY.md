# Prufs Cloud - Fly.io Deployment Guide

## Prerequisites

1. Install flyctl: `brew install flyctl` (macOS)
2. Sign up / log in: `fly auth login`
3. Have your Neon DATABASE_URL ready (with rotated password)

## First-time setup

From the `packages/cloud` directory:

```bash
# Create the Fly app (only once)
fly launch --config fly.toml --no-deploy

# Set the database connection string as a secret
fly secrets set DATABASE_URL="postgresql://neondb_owner:<PASSWORD>@ep-small-smoke-ak39f35j-pooler.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require"

# Deploy
fly deploy
```

## Verify deployment

```bash
# Check health
curl https://api.prufs.ai/health

# Check API info
curl https://api.prufs.ai/

# Test auth (use your API key)
curl https://api.prufs.ai/v1/orgs/cognitionhive \
  -H "Authorization: Bearer prfs_<YOUR_KEY>"
```

## Subsequent deploys

```bash
cd packages/cloud
fly deploy
```

## Monitoring

```bash
# Live logs
fly logs

# Status
fly status

# SSH into the machine (debugging)
fly ssh console
```

## Scaling

```bash
# Add a second machine (for availability)
fly scale count 2

# Upgrade memory
fly scale memory 512

# Check current config
fly scale show
```

## Custom domain (future)

```bash
# Add api.prufs.ai
fly certs add api.prufs.ai

# Then add a CNAME record in Cloudflare:
# api.prufs.ai -> LIVE (custom domain on Fly.io with Lets Encrypt TLS)
```

## Cost

Fly.io free tier includes:
- 3 shared-cpu-1x VMs with 256MB RAM
- 160GB outbound transfer

The Prufs Cloud config uses auto-stop, so the machine scales to zero
when idle and starts on incoming request. At low traffic, this is
effectively free.
