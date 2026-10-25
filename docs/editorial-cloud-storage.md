# Editorial image workflow

Editorial images are kept in private CloudBase storage and served through the allowlisted `get-editorial-asset-urls` action.

1. Put source images in `flower-assets/editorial/source/` and update the manifest in `scripts/build-editorial-cloud-assets.mjs` when adding keys.
2. Run `npm run assets:cloud` to generate optimized JPEGs under `flower-assets/editorial/cloud-ready/`.
3. Upload those files to the `editorial/` directory in your own private CloudBase bucket.
4. Run `npm run assets:map-cloud -- cloud://YOUR_BUCKET_ID/editorial/` with your exact CloudBase file ID prefix.
5. Deploy `flowerBackend` to your own CloudBase environment.

The generated file ID map is environment-specific. Do not copy another installation's `editorial-assets.json` or publish private file IDs as reusable configuration. Keep image rights and attribution details in `ASSET-LICENSES.md` and the asset source record.
