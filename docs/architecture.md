# Architecture

## Client

- `miniprogram/app.*`: Mini Program entry and global styles.
- `miniprogram/pages/flower/`: the active page and its creation, scene, and work actions.
- `miniprogram/data/`: generated flower and editorial catalogs.
- `miniprogram/utils/`: CloudBase client calls, local storage, image handling, brand configuration, and domain helpers.

## Backend

- `cloudfunctions/flowerBackend/`: authenticated business actions, account bootstrap, assets, works, quotas, and orders.
- `cloudfunctions/flowerTaskWorker/`: queued AI task execution and settlement.
- `cloudfunctions/houseflowerMaintenance/`: retention and account cleanup jobs.
- `cloudfunctions/houseflowerNotification/`: scheduled subscription notifications.

The client calls `flowerBackend`; the worker and scheduled functions perform privileged operations. Client uploads use per-user paths and are registered through the backend.

## Assets and tooling

- `flower-assets/` keeps source materials and generated manifests.
- `scripts/` builds smaller Mini Program material images, editorial catalogs, and validates the client structure.
- `typings/` contains the WeChat API declarations used by TypeScript.

The editorial catalog maps local asset keys to private CloudBase file IDs. A clone must generate this mapping for its own environment before using cloud-hosted editorial images.
