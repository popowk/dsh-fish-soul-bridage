# Changelog

## 1.1.4

- Adapt exact customer routes for dsh-fish-soul v0.16.4: Douyin candidate identity list/confirm/dismiss, archived self-memory pagination, sticker tagging/embedding backfill, and per-person memory consolidation.
- Strict schemas for Douyin candidate identity, bounded backfill workspaces/limits and self-memory offset; reuse the existing Douyin configuration permission and per-VM login controls.
- Bound model-heavy backfill/dream operations to three combined requests per hour and 240-second default upstream timeout (configurable up to 300 seconds).
- Add 0.16.4 gateway regression tests for authentication, query rejection, blocked privileged routes and simulated DSH forwarding; Windows tests and SnowLuma checks passed.
- Preserve the single Start.cmd, the complete SnowLuma v2.4.2 runtime, Node and Ayu. Do not bundle DSH Desktop or fish-soul plugin installers.
- Note: v0.16.4 fixes a cross-account conversation-context leak inside the upstream plugin itself. Existing DSH installations must update dsh-fish-soul to v0.16.4 separately.


## 1.1.3

- Adapt customer gateway for dsh-fish-soul v0.15.55: MiniMax TTS, MiniMax/DashScope STT; strict Douyin masterUid/shareCard/replyWindowMinutes schemas.
- Restore authenticated sticker viewing and native binary image imports (20 MiB max, verified image signatures, workspace/filename query checks), manual tag edits, and diagnostic logs.
- Add native endpoint inventory and regression coverage for Douyin inbox actions, tags, binary uploads, blocked unsafe file/command requests.
- Keep SnowLuma 2.4.2, Ayu, single Start.cmd and the release package unchanged except the gateway source; DSH Desktop and fish-soul installers remain excluded.


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