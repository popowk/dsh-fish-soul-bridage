# Changelog

## 1.0.0

- Rename unified project to `dsh-fish-soul-bridage` (repository spelling).
- Consolidate gateway, Ayu TTS, SnowLuma overlay into one directory layout and one root `Start.cmd`.
- Remove legacy component launchers, old versioned notes, and one-off diagnostics.
- Use script-relative paths for embedded Node, DSH helper, SnowLuma and Ayu; support user-provided `SNOWLUMA_DIR` for existing complete installations.
- Preserve gateway CODE/VMO reporting and SnowLuma secure bootstrap-password capture.
- Prevent use of the supplied incomplete SnowLuma overlay as a complete runtime; require CSS assets before startup.
- Add version identity through root `VERSION`, package.json, gateway health endpoint.
- Rehydrate missing static WebUI files from a local, complete, matching SnowLuma 2.4.2 installation without replacing patched JS or touching credential data.