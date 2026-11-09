# Previous public client asset compatibility

The current manifest retains only the own hashed JS/CSS resources of the last two deployed releases (v27 and v28). Unpublished intermediate versions are not retained. These files let an older open page finish loading and reach the existing version check; HTML, RSC payloads, server code, source maps, and authentication material are never retained here.

Before a future release, prepare the exact last two successfully deployed archives and run `python3 scripts/retain-client-assets.py <older.tar.gz> <latest.tar.gz>`. The script selects each archive's own Vite JS entries and RSC resource CSS, rather than copying transitively retained files. The script prunes only obsolete generated compatibility files whose contents match the previous recorded SHA256; review the resulting diff. The build fails if the actual compatibility set differs from the new manifest. Keep the total below 60 files / 4 MB. Never edit a retained hash-named file's contents.

`npm run build` emits current assets first, then restores the checked compatibility files. Current hash-name collisions must have identical bytes. The current HTML and client entry continue to reference only the new release. Keep HTML/version/admin/API no-store policies and the existing recommendation-preserving updater unchanged.
