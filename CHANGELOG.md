# Changelog

## 1.1.2

- Preserve bundled SnowLuma runtime files byte-for-byte on Windows checkout via `.gitattributes`.
- Add Windows runner verification for SHA-256-pinned VMO frontend assets before release.
- Package complete SnowLuma directly from GitHub repository without DSH Desktop or fish-soul plugin installers.


## 1.1.1

- Track the **complete patched SnowLuma 2.4.2 runtime** directly under `components/snowluma/`, including Node, backend, native dependencies and WebUI resources.
- Remove DSH Desktop offline installer and fish-soul .tgz plugin package from GitHub Windows release.
- Stop downloading SnowLuma during release builds: package exactly the files committed to the repository.
- Remove runtime scanning/copying of older SnowLuma installations and enforce a single bundled startup path.
- Preserve DSH Desktop as a preinstalled prerequisite, use the installed DSH CLI to find/install fish-soul when missing.


## 1.1.0

- Publish Windows-Full ZIP with SnowLuma v2.4.2 full runtime, Node, native modules and VMO BasePath/CSS/Logo fixes.
- Bundle Ayu bridge, fish-soul gateway, DSH Desktop 0.2.2-rc.1 offline installer and fish-soul plugin v0.15.33 tarball.
- Use system Python only; add checksum verification and unified Start.cmd installation/start.
- Keep source-only ZIP separate from deployable Windows-Full ZIP.


## 1.0.2

- Reconstruct and validate the unified Start-All.ps1 launcher after fixing a text substitution corruption in the initial v1.0.1 release.
- Windows Actions CI now reports PowerShell parse error locations and passes on the corrected script.
- Keep the SnowLuma 2.4.2 SHA-256-verified asset patch unchanged.


## 1.0.1

- Verify and patch three known SnowLuma 2.4.2 VMO frontend files (Logo, background preview, debug upload) by SHA-256 with backups and idempotence.
- Prefer existing complete SnowLuma 2.4.2 installations; integrate patching into unified Start.cmd.
- Update version checks and automated source release workflow; preserve v1.0.0 tag.
- No third-party SnowLuma binaries or credentials published.


## 1.0.0

- Rename unified project to `dsh-fish-soul-bridage` (repository spelling).
- Consolidate gateway, Ayu TTS, SnowLuma overlay into one directory layout and one root `Start.cmd`.
- Remove legacy component launchers, old versioned notes, and one-off diagnostics.
- Use script-relative paths for embedded Node, DSH helper, SnowLuma and Ayu; support user-provided `SNOWLUMA_DIR` for existing complete installations.
- Preserve gateway CODE/VMO reporting and SnowLuma secure bootstrap-password capture.
- Prevent use of the supplied incomplete SnowLuma overlay as a complete runtime; require CSS assets before startup.
- Add version identity through root `VERSION`, package.json, gateway health endpoint.
- Rehydrate missing static WebUI files from a local, complete, matching SnowLuma 2.4.2 installation without replacing patched JS or touching credential data.