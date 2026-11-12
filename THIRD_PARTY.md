# Third-party components and redistribution

- dsh-fish-soul (third-party DSH plugin): installed by the user's DSH CLI; this project does not contain upstream npm package source.
- Ayu-Breeze-Bridge v1.4: user-supplied bridge code, no stored provider keys.
- SnowLuma v2.4.2 patched runtime: uploaded binary overlay is NOT a complete SnowLuma distribution. Its `package.json` says `SEE LICENSE IN LICENSE`, but the provided archive does NOT include that LICENSE or full EULA. Avoid uploading vendor binaries into a public GitHub repo until licensing is confirmed; configure an authorized local full SnowLuma installation instead.
- React UMD: downloaded by the legacy gateway installer and pinned to v18.3.1; not vendored in the repository.
