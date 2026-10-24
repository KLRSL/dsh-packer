# dsh-packer

> **Agent Configuration Packer**: pack your local DSH assets into standard zip archives — migrate, share, restore, with a privacy scan guarding every pack.
>
> [简体中文](README.md) · [English](README.en.md)

> **v0.6.1** · MIT License · DSH 0.2.x (`>=0.2.0-rc.2 <0.3.0-0`, tested on the 0.2.1-rc.2 desktop app) · Node ≥ 22.19.0

**dsh-packer** is the Agent Configuration Packer plugin for **DeepSeek Harness (DSH)**: it packs your local Agent assets, module by module, into standard zip archives, for two purposes:

- **Migration** — move your entire setup to a new machine, or recover after a reinstall.
- **Sharing** — hand Skills and other assets to other people, with sensitive content filtered automatically.

Every module is optional (Skills / Sessions / Profiles / Settings / Presets / Memory); restore ships with diff reports and conflict strategies, and a privacy scan guards every pack — all capabilities are opt-in.

## Features

| Feature | Description |
| --- | --- |
| Modular packing | Seven modules, any combination: `skills` / `sessions` / `profiles` / `settings` / `presets` / `memory` (Markdown mirror) / `memoryDb` (**consistent SQLite snapshot of the memory truth source**, on by default) |
| Two built-in presets | **Migrate** (everything) / **Share** (Skills only; sessions, memory data and personal skill subdirectories are automatically excluded) |
| Privacy & security scan | Detects drive-letter / Unix / UNC paths, user-directory paths, credential assignments and bare key shapes (`sk-`, `ghp_`, `AKIA`, JWT, …), plus personal nicknames, counting **every occurrence**; **share mode hard-blocks on any hit, migrate mode reports only** |
| File-level operation preview | Full file list preview before packing; diff report before restore (added / changed / same / skipped) |
| Three conflict strategies | Overwrite / skip / merge (merge appends, never overwrites existing content) |
| Safe restore writes | Targets are backed up to `.restore-backups/<timestamp>/` inside the packs directory first, written to a temp file and swapped in with an atomic `rename`; any failure **aborts and rolls back** the files already replaced/added |
| Manifest integrity check | `manifest.json` records schemaVersion plus a SHA-256 fingerprint per file; source files are verified against it before restore, and a **missing or malformed fingerprint is rejected outright** (fail-closed) |
| Pack management & notes | Pack list (time / size / modules / note), delete, rename, and a note written at pack time |
| Share packs ship a README | A generated `README.md` describing the pack contents is attached automatically |
| Dark-mode ready | The settings page follows the DSH theme (`--dsw-alias-*` tokens plus a brand-amber dual palette, dual-channel detection) |
| Zero native dependencies | Standard zips built by a pure-JS ZIP writer (zip.mjs + node:zlib); openable by any unzip tool |
| Selective restore | Pick the **modules** to restore (Skills only, without touching sessions) and toggle `includeDb` separately to restore the memory truth-source database |
| Per-file diff | Importing a pack immediately computes added / changed / same / skipped, file by file, and the result card reports the backup directory |
| One-click rollback | `/restore/backups` lists every pre-restore backup; `/restore/rollback` (the UI's "Roll back" button) restores the files that run overwrote |
| Pack management | Browse a pack's file list with **inline SHA-256 verification**, rename, delete (deleted packs go to the **Windows Recycle Bin**, recoverable in Explorer) |
| Encrypted packs | `AES-256-GCM` with a `scrypt`-derived key (`PKENC1` container); manifests and restores require the passphrase, and a wrong passphrase fails closed |
| Progress & cancel | Packing and restoring run as background jobs (`/jobs/:id`) with a `done/total` percentage in the UI and a cancel button (honoured at file boundaries, no half-written zip) |

## Installation

### Desktop app: install by package name (recommended)

1. Open the DSH desktop app → **Plugins** in the sidebar → **Add plugin**;
2. Type the package name `dsh-packer` and click **Install** (it is enabled automatically).

CLI equivalent:

```bash
# replace desktop with your profile name
dsh plugin --profile desktop add dsh-packer
```

### From GitHub (alternative)

```bash
# Requires git
dsh plugin --profile desktop add github:KLRSL/dsh-packer
```

### As a local bundle (development / link)

```bash
# Run from the project directory
dsh plugin --profile desktop add link:./dsh-packer
```

`dsh plugin` registers the package into `dsh.profile.bundles` and mounts the patch automatically; restart DSH afterwards.

**Verify the install**:

1. Open **Settings → the "Config Packer" tab** — you should see the module checkboxes and the pack list.
2. Or run `/pack list` in the terminal — an empty list (or "no packs yet") means the command registered fine.
3. Run `/pack create --dry-run` once — it previews the file list and scan results without producing a zip, confirming the module paths are readable.

## Quick start

### Packing (three steps)

```bash
# 1. Create a migrate pack (everything selected by default)
/pack create --note "moving to a new machine"

# 2. Or create a share pack (Skills only, sensitive content excluded)
/pack create --share --note "for a friend"

# 3. Preview first without generating a zip
/pack create --mode migrate --dry-run
```

When it finishes, the zip is written to `~/.dsh/packs/` (override with `DSH_PACKS_DIR`); share packs automatically include a `README.md`.

### Restoring (three steps)

```bash
# 1. Import the pack
/pack restore ~/.dsh/packs/dsh-packer-2026-09-05-223045-migrate.zip

# 2. Review the diff report (added / changed / same / skipped)
# 3. Pick a conflict strategy: overwrite | skip | merge
/pack restore <zip-path> --strategy merge
```

`manifest.json` is validated automatically (schemaVersion + fingerprint validity + every source file's SHA-256) before anything is applied; each target is backed up first and swapped in atomically, and a failure aborts the batch and rolls it back. Restart DSH if needed afterwards.

## Packable modules

| Module | Contents | Migrate preset | Share preset |
| --- | --- | --- | --- |
| `skills` | Skills (including the memory-mechanism skill), under `~/.dsh/skills` | ✅ | ✅ |
| `sessions` | Session records (`.zstd` format), under `~/.dsh/sessions` | ✅ | ❌ |
| `profiles` | Profile configs (excluding `node_modules`), under `~/.dsh/profiles` | ✅ | ❌ |
| `settings` | Global settings (`settings.yaml`) | ✅ | ❌ |
| `presets` | Agent presets (`.agent-presets`) | ✅ | ❌ |
| `memory` | **Memory mirror** (human-readable Markdown under `DSH_MEMORY_ROOT` or `~/.dsh/memory`, excluding `backups/`) | ✅ | ❌ |
| `memoryDb` | **Memory truth source** (`<DSH_BIOMEMORY_DIR \|\| ~/.dsh/biomemory>/biomemory.db`): packed as a **consistent `VACUUM INTO` snapshot** (read-only connection, never touches a live WAL database); on failure the file is left out and reported under `unreadable` | ✅ | ❌ |

**The two built-in presets**:

- **Migrate** — every module checked by default: ideal for relocating a whole environment.
- **Share** — only `skills` is checked; sessions and memory data are excluded automatically, and personal skill subdirectories (`_shared`) are also excluded, keeping sensitive content out of the pack as much as possible.

## Privacy & security

**Scan rules** (scope: files with known text extensions plus extensionless files that are clearly text, e.g. `.env`; binaries containing NUL bytes are skipped):

| Rule | Description |
| --- | --- |
| Local absolute paths (drive letter) | Drive-letter style paths such as `D:\...`, `C:/...` |
| Unix absolute paths | `/home/...`, `/Users/...`, `/root/...`, `/etc/...`, `/tmp/...`, … |
| UNC / network paths | `\\server\share\...` |
| User-directory paths | Paths under the OS user profile directory (`C:\Users\<name>`, `/home/<name>`, `/Users/<name>`) |
| Suspected credentials / tokens | Assignments such as `api_key`, `access_key`, `secret`, `password`, `token`, `bearer`, `authorization`, `credential` — **quoted or unquoted** |
| Bare key shapes | The keys themselves: `sk-...`, `ghp_...`, `github_pat_...`, `glpat-...`, `AKIA...`, `xox?-...`, JWTs (`eyJ.....*.*`) |
| Personal nicknames | User nickname text (injected by the deployer via `config.personalPatterns`) |

Counts are tallied per file + rule + line, so multiple hits on one line are all counted (no more "one hit per rule per file").

**Blocking policy**:

- **Share mode** — any hit returns an error and the pack is **hard-blocked**; no zip is produced. Share packs are meant for others, so the policy is deliberately strict.
- **Migrate mode** — hits are reported only; inspect them in advance with `/pack scan` or `--dry-run` and decide yourself.

**Never packed**: `.credentials.yaml` and `.anonymous-user-id` are skipped in every module's file walk, regardless of mode — local identity/credential files never enter a pack.

Other security measures:

- Every file's **SHA-256** fingerprint is recorded in `manifest.json` for fail-closed integrity checks on restore; entries **without a well-formed fingerprint are rejected**, and files whose hash cannot be computed are skipped at pack time and reported (a blank fingerprint is never written).
- Restore containment is **two-sided**: the source must stay inside the extraction directory and the target must stay inside its module root (zip-slip / tampered manifests with `../` escapes are rejected). Absolute paths, drive-letter paths, UNC paths and `..` segments are rejected by a whitelist before restore even starts.
- Before unpacking, archive members are listed with `tar -tf` and whitelisted (absolute / drive-letter / UNC / `..` names rejected), and symlink / hardlink / device members are refused; the extracted tree is scanned again for symlinks. Temporary extraction directories are always cleaned up in `try/finally` — on success and on failure.
- Targets are backed up first (`<packs>/.restore-backups/<timestamp>/`), written to a temp file and swapped in with an atomic `rename`; any failure aborts and rolls back what this run already replaced or added.
### How memory migrates (read this)

The `memory` module in a pack only carries the **human-readable Markdown mirror**; the real source of truth is the SQLite database
`<DSH_BIOMEMORY_DIR || ~/.dsh/biomemory>/biomemory.db`. A live WAL database cannot be copied safely, so it is **never in the pack**.
To migrate memory completely: **stop DSH first**, then copy `biomemory.db` (plus any `-wal` / `-shm` sidecars) to the same path on the target machine.
Moving the pack alone gives the target only the mirror, not the memory itself.

- SQLite is handled on both sides: **packing** takes a consistent `VACUUM INTO` snapshot (`memoryDb`, since v0.2.6) instead of copying a live, DSH-held WAL database (failure means the file is skipped and listed under `unreadable`); **restore** still skips `*.db*` by default (`includeDb: true` writes them) so a memory database in use on the target machine is never overwritten.
- Pack file names carry a unique suffix (`dsh-packer-<timestamp>-<random>-<mode>.zip`) so packs created within the same second never overwrite each other.
- Packs are built by the plugin own **pure-JS ZIP writer** (zip.mjs, node:zlib) — standard zips with **zero native npm dependencies and no external commands**.
- All file and subprocess work is asynchronous (`node:fs/promises` + `execFile`), with bounded concurrency (16 by default) for hashing and copying, so packing large trees never blocks DSH's event loop.

### Settings Web API (`/packer/api/*`): auth & limits

The Settings tab is a peer of the `/pack` command and talks to the plugin's own prefix route, `/packer/api/*`. That route is **fail-closed** by default, and the checks run in the order "rate limit → auth → body size → routing", with all three gates completed **before the request body is buffered**:

| Item | Default | Behaviour |
| --- | --- | --- |
| Auth | `api.authMode: 'auto'` | **Official mechanism only**: `requestRejection(req)` on `ctx.get('connection')` (dsh-client-connection) — the same Host/Origin trust plus signed browser session check the official `/api` channel uses. `401` → 401, `403` → 403, only `undefined` lets the request through |
| Auth service unavailable | **Hard 403** | If the `connection` service is missing, has no `requestRejection`, or throws, the request is rejected with 403 and a reason; the plugin **never silently falls back** to a weaker path (the built-in token channel requires opting in with `authMode: 'token'`) |
| Rate limit | 60 / 60 s | **Outermost**: a sliding window keyed by client address (`remoteAddress`), evaluated before auth and before reading the body, so unauthenticated traffic consumes the same quota. Over the limit: 429 with `retry-after`; the key table is bounded (no timers, bounded memory) |
| Body size limit | 8 MB | Decided **before the body is fully buffered**: a declared `Content-Length` over the limit is rejected with 413 without reading a single byte; without a length the body is counted while streaming and the connection is unbound, paused and answered with 413 the moment it exceeds the limit |
| Error messages | Redacted | Server-side absolute paths (drive letter / UNC / Unix home dirs) are replaced with `<路径已隐去>` before leaving the process, so directory layout is never echoed to the browser |

`api` options (`apply(ctx, { api: { ... } })`):

| Option | Default | Notes |
| --- | --- | --- |
| `authMode` | `'auto'` | `'auto'`: official `connection` only, 403 when unavailable; `'token'`: **explicit opt-in** plugin-owned fallback — Host / Origin / `Sec-Fetch-Site` same-origin checks plus a one-time token (generated at `apply` time, injected into the same-origin `index.html` via `webServer.tapIndex`; the UI sends it as the `x-dsh-packer-token` header), for hosts that genuinely have no `connection` service; `'off'`: **insecure**, isolated tests only |
| `maxBodyBytes` | `8388608` | Body size limit in bytes |
| `rateLimit` / `rateWindowMs` | `60` / `60000` | Rate-limit count and window (ms) |
| `token` | random | Only used with `authMode: 'token'`; pass one explicitly to pin it for multi-instance or test setups |

`authMode: 'off'` and an explicitly pinned `token` hand the security decision to the deployer; they are documented so you know what you opted into, not because they are recommended.

## Restore & diff

Restore flow:

1. **Import the zip** — pick the file in the Settings tab, or `/pack restore <zip-path>`.
2. **Archive validation** — members are listed and whitelisted first (absolute / drive-letter / UNC / `..` / link-type members rejected), then `manifest.json` is read.
3. **Manifest validation** — `manifest.json` exists, its schemaVersion is compatible, every entry has a well-formed SHA-256 fingerprint, and every source file's hash matches; any mismatch is **fail-closed**.
4. **Diff report** — added / changed / same / skipped counts and file lists.
5. **Pick a conflict strategy**:
   - `overwrite` — replace the target file with the pack's content (default);
   - `skip` — keep the target file and skip conflicting entries;
   - `merge` — for text files, **append** the pack's content to the end of the target behind a separator comment; existing content is never overwritten. Non-text files fall back to overwrite.
6. **Backup → atomic swap → rollback on failure** — every target that will be replaced or appended to is backed up to `<packs>/.restore-backups/<timestamp>/` first, and the pack's content is written to a temp file and swapped in with an atomic `rename`; **any failure aborts the batch** and rolls back everything this run replaced or added (counts return to zero and the rolled-back number is reported separately).
7. Apply, and restart DSH if needed.

Files already identical to the pack are skipped automatically under every strategy. **Merge is not supported for structured configs** (JSON/YAML) — appending corrupts them; use overwrite or merge manually. Live SQLite databases (`*.db*`) are skipped by default to avoid overwriting memory data.

## `/pack` command reference

```text
/pack list                                                 # list packs (encrypted ones are marked)
/pack create [--modules skills,memory] [--mode migrate|share] [--note note] [--dry-run] [--encrypt passphrase]
/pack create --share                                       # --share is shorthand for --mode share
/pack restore <zip-path> [--strategy overwrite|skip|merge] [--modules a,b] [--include-db] [--password passphrase]
/pack scan                                                 # privacy-scan every packable module
```

| Command | Arguments | Description |
| --- | --- | --- |
| `list` | — | Lists generated packs: creation time, size, included modules, note, encryption flag |
| `create` | `--modules a,b` pick modules by name; `--mode migrate\|share` (default `migrate`); `--share` shorthand; `--note note`; `--dry-run` preview only; `--encrypt passphrase` | Without `--modules`, modules follow the mode preset (migrate = all; share = Skills only) |
| `restore` | `<zip-path>`; `--strategy overwrite\|skip\|merge`; `--modules a,b` restore only those modules; `--include-db` also restore the memory database (stop DSH first); `--password passphrase` | Import → validate → diff → apply with the chosen strategy; encrypted packs require the passphrase |
| `scan` | — | Runs the privacy scan over every packable module and reports sensitive traces |

Pack verification no longer has its own command: the settings page's "Browse" recomputes SHA-256 while listing files and flags mismatches in red.

**Output directory**: packs are written to `~/.dsh/packs/` (override with `DSH_PACKS_DIR`); names look like `dsh-packer-<timestamp>-<random>-<mode>.zip` (the unique suffix keeps same-second packs from overwriting each other), and each pack also gets a same-name `.json` summary file in the same directory (time / modules / note / file count) for the list view and quick identification. Restore backups go to `.restore-backups/<timestamp>-<random>/` in that same directory (safe to delete at any time; neither the list nor the plugin reads it). Pack list, delete and rename are also available in the Settings → "Config Packer" tab.

## Configuration & environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_PACKS_DIR` | `~/.dsh/packs` | Pack output directory |
| `DSH_MEMORY_ROOT` | `~/.dsh/memory` | Location of the `memory` module data |
| `DSH_HOME` | `~/.dsh` | DSH data root (base for all module paths) |

The Settings page is one page in five blocks, following the packer's task chain: **existing packs → contents to pack → pack options → restore (with per-item diff) → result details**. Pack info, integrity verification, rename and delete live on the pack row (delete goes to the Windows Recycle Bin); restore shows the diff first, then module selection and strategy, and the result block reports the backup directory with a one-click rollback. Chinese-only copy, no icon characters, statuses in words.

## Compatibility

- **Node.js** ≥ 22.19.0
- **DSH version gate**: `engines.dsh` = `>=0.2.0-rc.2 <0.3.0-0` (tested on the 0.2.1-rc.2 desktop app). DSH evaluates compatibility with `includePrerelease`, so prerelease identifiers participate in range checks; DSH versions outside this range are refused by the plugin manager before install.
- **Peer dependencies**: `@deepseek-ai/cordis` ^4.0.2 (plugin lifecycle baseline, provided by the host); `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-session` share the `>=0.2.0-rc.2 <0.3.0-0` range and are **not imported by `index.mjs`** — the plugin only uses host services such as `ctx.commands` / `ctx.webServer` / `ctx.slots`, so both are marked `optional: true` in `peerDependenciesMeta`.
- **No external commands**: packs are read and written directly by zip.mjs (node:zlib) — creating, listing and extracting never call tar, bsdtar or unzip, and any standard unzip tool can open the produced packs.

## Version history

| Version | Date | Type | Highlights |
| --- | --- | --- | --- |
| **v0.6.1** | 2026-10-25 | **Plugin card copy rewritten** | Localized title ("Config Packer") and one-line summary via `locale/en.json` / `locale/zh.json` `meta`; `description` no longer embeds the version or lists features. No functional changes. |
| **v0.6.0** | 2026-10-25 | **Settings page rebuilt around the packer's job** | The UI is no longer a form of module cards and buttons; it is one page following the task chain, in five blocks: **existing packs** (name / time / contents / size / encryption, with restore · pack info · delete — delete goes to the Windows Recycle Bin) → **contents to pack** (plain-language list: skills / installed plugins / memory database / sessions / config & presets, with sizes and a total) → **pack options** (as-is / sanitize before packing / encrypt, with passphrase, scan verdict, progress and cancel) → **restore** (pick a pack or a path → per-item diff: in pack vs on this machine vs how to handle → module selection + memory-db toggle → strategy) → **result details** (overwritten / added / skipped / needs confirmation / failed + backup directory + one-click rollback). Naming now follows the plugin itself (no more box/seal/unseal metaphors); Chinese-only copy, **no emoji or icon characters**, statuses expressed in words. `lib/client.js` 1048 → 1421 lines. Backend adds two fields: `modules` and `sha256` per pack in `GET /packs`, and `pack.sha256` in the create result. Tests 80/80. |
| **v0.5.1** | 2026-10-25 | **Privacy actually handled + plugins travel with migrations** | (1) Privacy goes from "report only" to "must handle": the pack page offers **Sanitize before packing** (rewrites only the copy inside the pack — paths become `<本机路径>` / `<用户目录>` / `<UNC路径>` / `<Unix路径>`, credentials become `<已移除的密钥>`; source files are never touched; forced in share mode) and **Pack as-is** (faithful; warns when credentials are included without a passphrase). (2) Five safety gates for sanitizing: single left-to-right pass, structural characters excluded, any hit containing `{ } [ ] , ; " '` is skipped with a warning, JSON/JSONL is re-parsed with line-shape checks (whole file reverted on failure), non-UTF-8 files are never sanitized, and size/sha256 are recomputed after rewriting (otherwise restore would reject the pack as tampered). (3) New `plugins` module packs the **installed plugin bodies** (`profiles/*/node_modules` top-level packages, scoped `@scope/*` handled, pnpm links followed, cycles guarded) — on by default for migration, never for sharing. (4) Restore back-fills sanitized packs (`<用户目录>` → target home, `<用户名>` → current user) and reports retained placeholders in `stats.warnings`. (5) `/scan` findings carry a `kind` (7 values). Tests 80/80. |
| **v0.5.0** | 2026-10-25 | **Slimming (small is beautiful)** | Deletions only: (1) the built-in trash bin is gone (3 endpoints + a panel) — deleted packs now go to the **Windows Recycle Bin**; (2) scheduled backups, the retention policy and their config file are gone (no scheduler); (3) the standalone `verify` endpoint and command are gone — verification is folded into "Browse", which recomputes SHA-256 while listing files and flags mismatches; (4) `/status` drops `trashCount` / `retention` / `autoBackup` / `disk.trashBytes`; (5) the UI goes from three tabs to **two (Pack / Restore)** with pack management moved onto the Restore pack row, the whole English copy table is removed (Chinese-only personal tool), and `lib/client.js` shrinks from 2334 to ≤1100 lines; (6) the result card gains a "Copy path" action. Endpoints: 15 → 9 groups. Kept: progress & cancel, encrypted packs (one toggle + passphrase), selective restore, `includeDb`, restore backups with one-click rollback, privacy scan and share guard. |
| **v0.4.0** | 2026-10-25 | **Feature completion + UI rebuild + three broken security promises fixed** | (1) **False-negative scan fixed**: the settings page's "Scan" used to downgrade the file list to `{module,rel,size}` and drop absolute paths, so `privacyScan` could not read any file and always reported "no sensitive traces"; `abs` is passed again. (2) **Share protection now enforced server-side**: `share` mode rejects `sessions`/`profiles`/`settings`/`presets`/`memory`/`memoryDb` with `400 share_scope` instead of trusting the UI. (3) **Memory database can be restored**: `includeDb` is now reachable from a UI toggle and `--include-db` (previously API-only). (4) `/status` no longer runs `VACUUM INTO` on the memory DB (the old code leaked a ~2.9 MB snapshot per settings-page open). (5) `strategy`/`mode` are whitelisted fail-closed (invalid values used to degrade silently to overwrite). (6) New: background jobs with progress/cancel, selective restore, per-file diff, pack-content browsing, `/pack verify`, trash bin, AES-256-GCM encrypted packs, scheduled backups + retention, one-click rollback of a restore. (7) UI rebuilt from one long page into **three tabs (Pack / Library / Restore)** with custom input and confirm dialogs (`window.prompt`/`confirm` removed — Electron does not support `prompt`, so Rename never worked in the desktop app). 74/74 tests pass. |
| **v0.3.0** | 2026-09-29 | Bug fix | **Missing module in the UI fixed**: the settings page hard-coded a 6-entry module list, so the `memoryDb` module added in v0.2.6 (the SQLite truth-source snapshot) **could not be selected at all**. The list is now driven entirely by the host's `/status` payload (`moduleOrder(status.modules)`), and default selection iterates every module the host reports. Two consistency guards were added to the test suite (the client must not hard-code a module list; every host module must be renderable by the client). 50/50 tests pass. |
| **v0.2.6** | 2026-09-29 | Feature / adaptation | **The memory truth source is now inside the pack (consistent snapshot) + DSH 0.2.0-rc.2 adaptation**, superseding the v0.2.5 limitation: (1) new `memoryDb` module — the runtime source of truth (`<DSH_BIOMEMORY_DIR || ~/.dsh/biomemory>/biomemory.db`) is packed as a `VACUUM INTO` snapshot taken over a read-only connection (never a copy of a live WAL database; measured 2.78MB → 2.57MB, entries and audit rows intact); a failed snapshot leaves the file out and reports it under `unreadable` rather than silently degrading; snapshots live in a temp directory and are always cleaned up (success, failure and `--dry-run` alike); (2) dropped `@deepseek-ai/dsh-client-runtime` from `dsh.client.inject` — that package does not exist in 0.2.0. 48/48 tests pass |
| **v0.2.5** | 2026-09-20 | Semantics | **The "memory" in a pack is only the mirror**: the `memory` module packs the read-only Markdown copy under `~/.dsh/memory`, while the runtime source of truth is SQLite (`~/.dsh/biomemory/biomemory.db`) — excluded by `skipFiles` and never scanned (a live WAL database cannot be copied safely). The module label now reads "memory mirror (…; the live SQLite database is not in the pack)" and both READMEs gained a **How memory migrates** section: **stop DSH first**, then copy `biomemory.db` (plus `-wal`/`-shm`) by hand — the pack alone gives the target only the mirror. Also: client bundle moved to `lib/client.js`. 47 tests green |
| **v0.2.4** | 2026-09-17 | Async / security | File and subprocess work is async end to end (`node:fs/promises` + `execFile`, streaming hashes, bounded concurrency of 16 for hashing and copying, `sha256()` now throws on failure); the public API returns Promises and no longer blocks the event loop; new `/packer/api/*` protections: fail-closed auth (official `connection.requestRejection` only — a missing service, missing method or a throwing call is a hard 403), an explicitly opted-in one-time-token fallback (`authMode: 'token'`, same-origin checks + `webServer.tapIndex` injection), a rate limit (60/min, outermost gate) and a body size limit (8 MB, decided before the body is buffered), plus path redaction in error messages; `apply()` now explicitly wires the handler into `webServer.register({ kind: 'prefix', path: '/packer/api' })`; tests grown to 47 cases (unauthorized 403 / oversized 413 / rate-limited 429 / token path / no-connection default deny / apply wiring) |
| **v0.2.3** | 2026-09-16 | Security hardening | Target-path containment plus a `rel` whitelist on restore (absolute / drive-letter / UNC / `..` rejected); integrity made fail-closed (missing or malformed fingerprints rejected, `sha256()` now throws instead of returning `''`, streaming hash); archive members whitelisted via `tar -tf` before unpacking, link-type members refused, temp dirs always cleaned in `try/finally`; restore now backs up → temp file → atomic `rename` → abort-and-rollback on failure; `memory` module excludes `*.db*` by default; privacy scan gained Unix/UNC paths, unquoted credentials and bare key shapes, `.env`-style extensionless text, with per-line full counting; unique pack-name suffix; `peerDependenciesMeta` marks host-provided peers optional; the web UI now surfaces server-side error reasons |
| **v0.2.2** | 2026-09-05 | Adaptation / UI | Adapted for DSH 0.1.2-rc.1; management panel redesigned on the "skeleton / flesh / breath" design language — packing-workflow layout (stage progress bar / equipment panel / diff color bands) + orange-amber-teal brand palette (packing & migration) + dark-mode support (follows DSH theme, dual-channel detection) |
| **v0.2.1** | 2026-09-05 | UI refactor | Config Packer panel UI rebuilt — neutralSurface background + white cards (max-width 860 centered, radius 16), 4/8px grid spacing, restrained 150ms transitions; colors strictly from dsh-fuse default tokens (`--pk-*` variables, zero hardcoded values); diff report got four-column count badges + semantic color dots (added=green / changed=orange / same+skipped=muted); privacy risks default to a warning tint |
| **v0.2.0** | 2026-09-05 | Security hardening | Privacy scan fixed: merged personal rules now actually participate in the loop; every source file is verified against its manifest SHA-256 before restoring (fail-closed); restore path containment (zip-slip / tampered-manifest escapes rejected); append-merge refused for structured configs (JSON/YAML — it corrupts them) |
| **v0.1.2** | — | Metadata / deps | package.json gained `keywords` / `files` metadata; peerDeps relaxed to ≥0.1.1-rc.2; README version & dependency notes synced |
| **v0.1.0** | — | Initial release | Modular packing (skills / sessions / profiles / settings / presets / memory), privacy scan, restore diff, pack management, Settings panel |

## FAQ

**The zip won't open / looks corrupted?**

Packs are standard zips created by the plugin pure-JS ZIP writer — Windows Explorer and common unzip tools can open them. If a pack fails validation, don't hand-edit its contents (that breaks the SHA-256 fingerprints in `manifest.json`); regenerate it with `/pack create`. Check `~/.dsh/packs` (or your `DSH_PACKS_DIR`) with `/pack list` to see what's there.

**Manifest validation fails on restore?**

Usually one of: the zip was not created by dsh-packer (no `manifest.json` inside), `manifest.json` is missing or its schemaVersion is incompatible with the current version, or the pack was modified after creation. Redistribute the original pack or regenerate it.

**My share pack got blocked — what now?**

Share mode is deliberately strict: any hit (absolute path, user-directory path, suspected credential, nickname, …) aborts the pack with an error. Run `/pack scan` to see which files match, clean or replace the sensitive content, then retry. For personal backups you can use migrate mode (report-only), but never distribute such packs to others.

**How does the merge strategy work?**

For text files, the pack's content is **appended** to the target file behind a separator comment — existing content is never overwritten. Non-text files fall back to overwrite; structured configs (JSON/YAML) don't support merging at all (appending corrupts them) — use overwrite or merge manually. Files already identical to the pack are skipped under every strategy.

**What does "aborted / rolled back" on restore mean?**

Restore is all-or-nothing: if any step (path validation, fingerprint check, writing) fails, it stops immediately and rolls back the files this run already replaced or added, using the backups taken moments earlier. `rolled back N` reports how many files were restored; failure reasons are listed entry by entry in the Settings tab. Backups stay under `<packs>/.restore-backups/` for manual inspection.

**Why wasn't my memory database (`*.db*`) restored?**

Live SQLite databases are held open by DSH / the memory plugin, so overwriting them can corrupt data. The plugin neither packs nor restores `*.db`, `*.db-wal`, `*.db-shm` or `*.sqlite` by default; on restore they are counted as skipped with an explicit reason.

To actually move memory across: **quit DSH first**, then enable the `includeDb` toggle on the restore tab (or `/pack restore <pack> --include-db`). The packed database comes from a consistent `VACUUM INTO` snapshot (the `memoryDb` module), so it is complete and usable.

**Restore says "entry is missing a valid SHA-256 fingerprint"?**

The pack was not generated by dsh-packer, or its `manifest.json` was hand-edited. Missing or malformed fingerprints are rejected outright (fail-closed) — redistribute the original pack or regenerate it.

**Where are packs stored?**

`~/.dsh/packs` by default, overridable via the `DSH_PACKS_DIR` environment variable; each pack also has a same-name `.json` summary file in the same directory for identification and the list view.

## Development

```bash
npm test                          # node --test "tests/*.test.mjs", 37 tests, all green
node scripts/release-check.mjs    # release consistency check (version / README version exposure / files whitelist / git state)
```

**CI**: `.github/workflows/ci.yml` runs "release check → unit tests → `npm pack --dry-run`" on Node 22.x / 24.x (this package has zero runtime dependencies, so there is no install step) for every push and pull request.

## License

MIT — see [LICENSE](LICENSE).
