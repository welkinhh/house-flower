# CloudBase setup

This guide describes the optional backend. The repository contains no shared CloudBase credentials or production environment IDs.

## Configure an environment

1. Create a CloudBase environment that you control.
2. Replace `YOUR_CLOUDBASE_ENV_ID` in `cloudbaserc.json` and `miniprogram/utils/cloud-env.ts`.
3. Replace `touristappid` in `project.config.json` with the mini-program AppID you control before testing real WeChat identity or uploads.
4. Create these NoSQL collections: `users`, `identities`, `daily_quotas`, `quota_ledger`, `ai_tasks`, `assets`, `works`, `recognitions`, `important_dates`, `asset_refs`, `analytics_events`, `subscription_records`, `notification_jobs`, and `recharge_orders`.
5. Keep collections and storage private. The client should access user data through `flowerBackend`; do not enable public reads for private user assets.

## Cloud functions

`cloudbaserc.json` defines these functions:

| Function | Purpose |
| --- | --- |
| `flowerBackend` | Identity, uploads, works, quotas, account operations, and orders |
| `flowerTaskWorker` | Queued bouquet, recognition, and scene tasks; timer trigger |
| `houseflowerMaintenance` | Retention and account cleanup; timer trigger |
| `houseflowerNotification` | Scheduled subscription notifications; timer trigger |

Deploy the functions to your own environment with the CloudBase CLI. Review the function package files and deployment plan before deploying.

## Environment variables

- `ADMIN_OPENIDS`: comma-separated OpenIDs allowed to use operator actions.
- `AI_RESOURCES_ENABLED`: leave `false` until the image model is configured and its cost is understood.
- `AI_VISION_ENABLED`: leave `false` unless a vision model is configured.
- `RECHARGE_MCH_ID`: optional; leave empty when payments are not configured.
- `SUBSCRIBE_TEMPLATE_DATE`, `SUBSCRIBE_TEMPLATE_TASK`, and `SUBSCRIBE_FIELD_MAP_JSON`: optional notification templates.

Do not put API keys, merchant secrets, or private credentials in the Mini Program client or Git. Store them in protected CloudBase function settings.

## Editorial images

The tracked `flower-assets/editorial/storage-prefix.json` is intentionally blank. Upload the generated files from `flower-assets/editorial/cloud-ready/` to your private `editorial/` folder, then pass your exact CloudBase file ID prefix to `scripts/build-editorial-fileids.mjs`. The script writes `cloudfunctions/flowerBackend/editorial-assets.json` for that environment.

The sample file ID map is empty until you generate one. Cloud-hosted editorial images will not load before that step.
