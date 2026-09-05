# dsh-packer

[中文文档](README.zh-CN.md) · Agent Configuration Packer for DeepSeek Harness

> **v0.2.2** · MIT License · Node.js ≥ 22.19.0 · DeepSeek Harness ≥ 0.1.1-rc.2

**dsh-packer** is the Agent Configuration Packer plugin for **DeepSeek Harness (DSH)**: it packs your local Agent assets, module by module, into standard zip archives, for two purposes:

- **Migration** — move your entire setup to a new machine, or recover after a reinstall.
- **Sharing** — hand Skills and other assets to other people, with sensitive content filtered automatically.

Every module is optional (Skills / Sessions / Profiles / Settings / Presets / Memory); restore ships with diff reports and conflict strategies, and a privacy scan guards every pack — all capabilities are opt-in.

## ✨ Features

| Feature | Description |
|---|---|
| Modular packing | Six modules, any combination: `skills` / `sessions` / `profiles` / `settings` / `presets` / `memory` |
| Two built-in presets | **Migrate** (everything) / **Share** (Skills only; sessions, memory data and personal skill subdirectories are automatically excluded) |
| Privacy & security scan | Detects local absolute paths, user-directory paths, suspected credentials and personal nicknames before packing; **share mode hard-blocks on any hit, migrate mode reports only** |
| File-level operation preview | Full file list preview before packing; diff report before restore (added / changed / same / skipped) |
| Three conflict strategies | Overwrite / skip / merge (merge appends, never overwrites existing content) |
| Manifest integrity check | `manifest.json` records schemaVersion plus a SHA-256 fingerprint per file; fail-closed validation before restore |
| Pack management & notes | Pack list (time / size / modules / note), delete, rename, and a note written at pack time |
| Share packs ship a README | A generated `README.md` describing the pack contents is attached automatically |
| Dark-mode ready | The workflow panel follows the DSH theme via `--dsw-alias-*` variables (dual-channel detection) |
| Zero native dependencies | Standard zips built with the system bsdtar (libarchive); openable by any unzip tool |

## 📦 Installation

Install as a local bundle from the project directory:

```bash
dsh plugin add .     # add the local bundle
# or, during development
pnpm link
```

Then add `dsh-packer` to the `dsh.profile.bundles` list of your profile and restart DSH.

**Verify the install**:

1. Open **Settings → the "Config Packer" tab** — you should see the module checkboxes and the pack list.
2. Or run `/pack list` in the terminal — an empty list (or "no packs yet") means the command registered fine.
3. Run `/pack create --dry-run` once — it previews the file list and scan results without producing a zip, confirming the module paths are readable.

## 🚀 Quick start

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

`manifest.json` is validated automatically (schemaVersion + SHA-256) before anything is applied; restart DSH if needed after applying.

## 📦 Packable modules

| Module | Contents | Migrate preset | Share preset |
|---|---|---|---|
| `skills` | Skills (including the memory-mechanism skill), under `~/.dsh/skills` | ✅ | ✅ |
| `sessions` | Session records (`.zstd` format), under `~/.dsh/sessions` | ✅ | ❌ |
| `profiles` | Profile configs (excluding `node_modules`), under `~/.dsh/profiles` | ✅ | ❌ |
| `settings` | Global settings (`settings.yaml`) | ✅ | ❌ |
| `presets` | Agent presets (`.agent-presets`) | ✅ | ❌ |
| `memory` | Memory data (`DSH_MEMORY_ROOT` or `~/.dsh/memory`, excluding `backups/`) | ✅ | ❌ |

**The two built-in presets**:

- **Migrate** — every module checked by default: ideal for relocating a whole environment.
- **Share** — only `skills` is checked; sessions and memory data are excluded automatically, and personal skill subdirectories (`_shared`) are also excluded, keeping sensitive content out of the pack as much as possible.

## 🛡 Privacy & security

**Scan rules** (text files only):

| Rule | Description |
|---|---|
| Local absolute paths | Drive-letter style paths (e.g. `D:\...`, `/home/...`) |
| User-directory paths | Paths under the operating system's user profile directory |
| Suspected credentials / tokens | Assignments such as `api_key`, `secret`, `password`, `token`, `bearer`, `authorization` |
| Personal nicknames | User nickname text |
| Windows user-name paths | OS user names appearing in paths |

**Blocking policy**:

- **Share mode** — any hit returns an error and the pack is **hard-blocked**; no zip is produced. Share packs are meant for others, so the policy is deliberately strict.
- **Migrate mode** — hits are reported only; inspect them in advance with `/pack scan` or `--dry-run` and decide yourself.

**Never packed**: `.credentials.yaml` and `.anonymous-user-id` are skipped in every module's file walk, regardless of mode — local identity/credential files never enter a pack.

Other security measures:

- Every file's **SHA-256** fingerprint is recorded in `manifest.json` for fail-closed integrity checks on restore.
- Restore paths are containment-checked (zip-slip / tampered manifests with `../` escapes are rejected).
- Packs are built with the system **bsdtar** (libarchive) — standard zips with **zero native npm dependencies**.

## 🔄 Restore & diff

Restore flow:

1. **Import the zip** — pick the file in the Settings tab, or `/pack restore <zip-path>`.
2. **Manifest validation** — `manifest.json` exists, its schemaVersion is compatible, and every source file's SHA-256 matches the manifest; any mismatch is **fail-closed** (nothing is applied).
3. **Diff report** — added / changed / same / skipped counts and file lists.
4. **Pick a conflict strategy**:
   - `overwrite` — replace the target file with the pack's content (default);
   - `skip` — keep the target file and skip conflicting entries;
   - `merge` — for text files, **append** the pack's content to the end of the target behind a separator comment; existing content is never overwritten. Non-text files fall back to overwrite.
5. Apply, and restart DSH if needed.

Files already identical to the pack are skipped automatically under every strategy. **Merge is not supported for structured configs** (JSON/YAML) — appending corrupts them; use overwrite or merge manually.

## 💻 `/pack` command reference

```
/pack list                                      # list existing packs (time/size/modules/note)
/pack create [--modules skills,memory] [--mode migrate|share] [--note note] [--dry-run]
/pack create --share                            # --share is shorthand for --mode share
/pack restore <zip-path> [--strategy overwrite|skip|merge]
/pack scan                                      # privacy-scan every packable module
```

| Command | Arguments | Description |
|---|---|---|
| `list` | — | Lists generated packs: creation time, size, included modules, note |
| `create` | `--modules a,b` pick modules by name; `--mode migrate\|share` (default `migrate`); `--share` shorthand; `--note note`; `--dry-run` preview only | Without `--modules`, modules follow the mode preset (migrate = all; share = Skills only) |
| `restore` | `<zip-path>` the pack to restore; `--strategy overwrite\|skip\|merge` | Import zip → validate → diff report → apply with the chosen strategy |
| `scan` | — | Runs the privacy scan over every packable module and reports sensitive traces |

**Output directory**: packs are written to `~/.dsh/packs/` (override with `DSH_PACKS_DIR`); each pack also gets a same-name `.json` summary file in the same directory (time / modules / note / file count) for the list view and quick identification. Pack list, delete and rename are also available in the Settings → "Config Packer" tab.

## ⚙️ Configuration & environment variables

| Variable | Default | Description |
|---|---|---|
| `DSH_PACKS_DIR` | `~/.dsh/packs` | Pack output directory |
| `DSH_MEMORY_ROOT` | `~/.dsh/memory` | Location of the `memory` module data |
| `DSH_HOME` | `~/.dsh` | DSH data root (base for all module paths) |

The Settings page's **"Config Packer"** tab (module checkboxes / preset switching / preview / pack / restore / pack management) is fully equivalent to the `/pack` command — GUI users can stay in Settings the whole way.

## 🧩 Compatibility

- **Node.js** ≥ 22.19.0
- **DSH packages** `@deepseek-ai/dsh-*` ≥ 0.1.1-rc.2 (current latest line; v0.2.2 is adapted for and tested on 0.1.2-rc.1; peer deps: `@deepseek-ai/cordis` ^4.0.2, `@deepseek-ai/dsh-tools` ≥0.1.1-rc.2, `@deepseek-ai/dsh-session` ≥0.1.1-rc.2)
- **bsdtar**: Windows 10+ ships `tar.exe` (bsdtar/libarchive); on macOS `tar` is bsdtar. No npm native modules are used.

## 📜 Version history

| Version | Date | Type | Highlights |
|---|---|---|---|
| **v0.2.2** | 2026-09-05 | Adaptation / UI | Adapted for DSH 0.1.2-rc.1; management panel redesigned on the "skeleton / flesh / breath" design language — packing-workflow layout (stage progress bar / equipment panel / diff color bands) + orange-amber-teal brand palette (packing & migration) + dark-mode support (follows DSH theme `--dsw-alias-*`, dual-channel detection) |
| **v0.2.1** | 2026-09-05 | UI refactor | Config Packer panel UI rebuilt — neutralSurface background + white cards (max-width 860 centered, radius 16), 4/8px grid spacing, restrained 150ms transitions; colors strictly from dsh-fuse default tokens (`--pk-*` variables, zero hardcoded values); diff report got four-column count badges + semantic color dots (added=green / changed=orange / same+skipped=muted); privacy risks default to a warning tint |
| **v0.2.0** | 2026-09-05 | Security hardening | ① Privacy scan fixed: the merged personal rules now actually participate in the loop (previously deployer-injected `personalPatterns` were silently skipped); ② every source file is verified against its manifest SHA-256 before restoring (fail-closed — a mismatch refuses, nothing is copied); ③ restore path containment (zip-slip / tampered-manifest `../` escapes rejected); ④ append-merge refused for structured configs (JSON/YAML — it corrupts them); use overwrite or merge manually |
| **v0.1.2** | — | Metadata / deps | package.json gained `keywords` / `files` metadata; peerDeps relaxed to ≥0.1.1-rc.2; README version & dependency notes synced |
| **v0.1.0** | — | Initial release | Modular packing (skills / sessions / profiles / settings / presets / memory), privacy scan, restore diff, pack management, Settings panel |

## ❓ FAQ

**The zip won't open / looks corrupted?**

Packs are standard zips created by the system bsdtar — Windows Explorer and common unzip tools can open them. If a pack fails validation, don't hand-edit its contents (that breaks the SHA-256 fingerprints in `manifest.json`); regenerate it with `/pack create`. Check `~/.dsh/packs` (or your `DSH_PACKS_DIR`) with `/pack list` to see what's there.

**Manifest validation fails on restore?**

Usually one of: the zip was not created by dsh-packer (no `manifest.json` inside), `manifest.json` is missing or its schemaVersion is incompatible with the current version, or the pack was modified after creation. Redistribute the original pack or regenerate it.

**My share pack got blocked — what now?**

Share mode is deliberately strict: any hit (absolute path, user-directory path, suspected credential, nickname, …) aborts the pack with an error. Run `/pack scan` to see which files match, clean or replace the sensitive content, then retry. For personal backups you can use migrate mode (report-only), but never distribute such packs to others.

**How does the merge strategy work?**

For text files, the pack's content is **appended** to the target file behind a separator comment — existing content is never overwritten. Non-text files fall back to overwrite; structured configs (JSON/YAML) don't support merging at all (appending corrupts them) — use overwrite or merge manually. Files already identical to the pack are skipped under every strategy.

**Where are packs stored?**

`~/.dsh/packs` by default, overridable via the `DSH_PACKS_DIR` environment variable; each pack also has a same-name `.json` summary file in the same directory for identification and the list view.

## 🧪 Development

```bash
npm test    # node --test "tests/*.test.mjs"
```

## 📄 License

MIT — see [LICENSE](LICENSE).
