# dsh-packer

[中文文档](README.zh-CN.md)

**dsh-packer** is a configuration packer plugin for **DeepSeek Harness (DSH)**. It packs your local Agent assets into zip archives, module by module, for two purposes:

- **Migration** — move your whole setup to a new machine or after a reinstall.
- **Sharing** — hand your Skills (and other assets) to other people.

Version **v0.1.2** · MIT License

**v0.1.2 (2026-09-03)**：settings panel UI modernization (visual style aligned with DSH 0.1.1-rc.2); **Compatibility**: DeepSeek Harness ≥ 0.1.1-rc.2 (tested on 0.1.2-rc.1 too).

---

## Features

### Packable modules (all optional)

| Module    | Contents | Migrate preset | Share preset |
|-----------|----------|:--------------:|:------------:|
| `skills`  | Skills (including the memory-mechanism skill), under `~/.dsh/skills` | ✅ | ✅ |
| `sessions`| Session records (`.zstd` format), under `~/.dsh/sessions` | ✅ | ❌ |
| `profiles`| Profile configs (excluding `node_modules`), under `~/.dsh/profiles` | ✅ | ❌ |
| `settings`| Global settings (`settings.yaml`) | ✅ | ❌ |
| `presets` | Agent presets (`.agent-presets`) | ✅ | ❌ |
| `memory`  | Memory data (`DSH_MEMORY_ROOT` or `~/.dsh/memory`, excluding `backups/`) | ✅ | ❌ |

### Two built-in presets

- **Migrate** — every module checked (the default).
- **Share** — only `skills` is checked; sessions and memory data are automatically excluded. Personal skill subdirectories are also excluded when sharing.

### Core capabilities

1. **Privacy & security scan** — before packing, automatically detects local absolute paths, user-profile directory paths, suspected credentials, and personal nicknames. In **share** mode a hit hard-blocks the pack (returns an error); in **migrate** mode it is reported only.
2. **File-level operation manifest** — previews every file before packing; before a restore it produces a diff report (added / changed / same / skipped).
3. **Package management** — lists generated packages (time / size / modules / note), delete, rename.
4. **Restore** — import zip → validate `manifest.json` (schemaVersion + SHA-256 fingerprints) → diff report → pick a conflict strategy: **overwrite / skip / merge** (merge appends, never overwrites).
5. **Share packs ship with a README** — a generated `README.md` explaining the pack contents is attached automatically.
6. **Package notes** — write a usage note when packing.

---

## Installation

Install as a local bundle from the project directory:

```bash
dsh plugin add .     # add the local bundle
# or, during development
pnpm link
```

Then add `dsh-packer` to the `dsh.profile.bundles` list of your profile. Restart DSH and open the **Settings → "Config Packer" tab** (or use the `/pack` command).

---

## Usage

### Packing flow

1. Open the **Settings → "Config Packer" tab**, or run `/pack create`.
2. Pick the modules — or use a preset (**Migrate** = everything, **Share** = Skills only).
3. The privacy scan runs automatically before packing; in share mode it hard-blocks on any hit.
4. Confirm the file list (use `--dry-run` to preview without generating a zip).
5. The zip is written to the packs directory (default `~/.dsh/packs`); share packs get an automatic `README.md`.

### Restore flow

1. Import the zip (pick the file in the Settings tab, or `/pack restore <zip>`).
2. `manifest.json` is validated (schemaVersion + SHA-256 fingerprints).
3. Review the diff report: added / changed / same / skipped.
4. Choose a conflict strategy: **overwrite / skip / merge** (merge appends text content without overwriting).
5. Apply, and restart DSH if needed.

### `/pack` command reference

```
/pack list                                      # list existing packs (time/size/modules/note)
/pack create [--modules skills,memory] [--mode migrate|share] [--note note] [--dry-run]
/pack create --share                            # --share is shorthand for --mode share
/pack restore <zip-path> [--strategy overwrite|skip|merge]
/pack scan                                      # privacy-scan every packable module
```

Details:

- `list` — shows generated packs with creation time, size, modules and note.
- `create` — without `--modules`, modules are chosen by the mode preset (migrate = all; share = Skills only). `--dry-run` only previews the file list and scan results; no zip is generated.
- `restore` — import zip → validate → diff report → apply with the chosen strategy. Files identical to the pack are skipped automatically under every strategy.
- `scan` — runs the privacy scan over every packable module and reports sensitive traces.

Package notes are written at pack time and shown in the package list. In the Settings tab you can also delete or rename packages.

---

## Privacy & security

- **Never packed**: `.credentials.yaml` and `.anonymous-user-id` are skipped in every module's file walk.
- **Scan rules** (text files only):
  - local absolute paths (drive-letter style)
  - user-profile directory paths (paths under the OS user profile)
  - suspected credentials/tokens (`api_key`, `secret`, `password`, `token`, `bearer`, `authorization` assignments)
  - personal nicknames
  - Windows user-name paths
- **Share mode**: any hit returns an error and the pack is **blocked**.
- **Migrate mode**: hits are reported only — inspect them with `/pack scan` or `--dry-run`.
- Every file's **SHA-256** fingerprint is recorded in `manifest.json` for integrity checks on restore.
- Packs are built with the system **bsdtar** (libarchive), producing standard zip files with **zero native dependencies**.

---

## Compatibility

- **Node.js** >= 22.19.0
- **DSH packages** `@deepseek-ai/dsh-*` >= 0.1.1-rc.2 (current latest line; tested on 0.1.2-rc.1 too; peer deps: `@deepseek-ai/cordis` ^4.0.2, `@deepseek-ai/dsh-tools` >=0.1.1-rc.2, `@deepseek-ai/dsh-session` >=0.1.1-rc.2)
- **bsdtar**: Windows 10+ ships `tar.exe` (bsdtar/libarchive); macOS ships bsdtar as `tar`. No npm native modules are used.

---

## FAQ

**The zip won't open / looks corrupted?**

Packs are standard zip archives created by the system bsdtar — Windows Explorer and common unzip tools can open them. If a pack fails validation, do not hand-edit its contents (that breaks the SHA-256 fingerprints in `manifest.json`); regenerate it with `/pack create`. Check `~/.dsh/packs` (or your `DSH_PACKS_DIR`) with `/pack list` to see what is there.

**Manifest validation fails on restore?**

Usually one of: the zip was not created by dsh-packer (no `manifest.json` inside), `manifest.json` is missing or its `schemaVersion` is incompatible with the current version, or the pack was modified after creation. Redistribute the original pack or regenerate it.

**My share pack got blocked — what now?**

Share mode is deliberately strict: any hit (absolute path, user-profile path, suspected credential, nickname, …) aborts the pack with an error. Run `/pack scan` to see which files match, clean or replace the sensitive content, then retry. For personal backups you can use migrate mode (report-only), but never distribute such packs to others.

**How does the merge strategy work?**

For text files, the pack's content is **appended** to the target file behind a separator comment — existing content is never overwritten. Non-text files fall back to overwrite. Files already identical to the pack are skipped under every strategy.

**Where are packs stored?**

`~/.dsh/packs` by default, overridable via the `DSH_PACKS_DIR` environment variable.

---

## License

MIT
