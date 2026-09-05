# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in dsh-packer, please report it **privately** before public disclosure:

- Open a [private security advisory](https://github.com/KLRSL/dsh-packer/security/advisories/new) (preferred), or
- Email the maintainer through your GitHub contact

Please include a description of the vulnerability, steps to reproduce, and affected versions. You should receive a response within 7 days.

Please do **not** open public issues for security vulnerabilities.

## Security Notes

dsh-packer is a **local-first** configuration packer:

- Packing is performed by the system `bsdtar` (libarchive); **zero npm native dependencies**.
- **Never packed**: `.credentials.yaml`, `.anonymous-user-id` — any sensitive module is always skipped.
- **Privacy scan before packing**: local absolute paths, user-directory paths, suspected credentials/tokens, personal nicknames. **Share mode blocks on any hit** (returns an error, no pack is generated); migrate mode reports only.
- **Restore safety**: `manifest.json` SHA-256 fingerprints are verified per source file (**fail-closed**: mismatch rejects, no partial copy); zip-slip / `../` path traversal in pack manifests is rejected.
- **Structured configs** (JSON/YAML) refuse append merge (which would corrupt them).

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅ |
