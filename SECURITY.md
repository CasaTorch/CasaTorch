# Security

CasaTorch runs in your home and keeps your home's data there. This file is the technical summary of how that
data is stored and protected, and how to report a problem. The user-facing version, with a diagram and a threat
model, is in the docs: **Help › Security and encryption**.

## Reporting a vulnerability

E-mail **support@casatorch.com** with "Security" in the subject. <!-- scrub-ok: public support address -->
Please include what you found, steps to reproduce, and the version you tested (Settings › Updates). Don't open a
public issue, and don't test against homes that aren't yours. We'll reply, keep you posted while we fix it, and
credit you in the release notes if you'd like.

In scope: the CasaTorch server (`app/`), the phone apps (`mobile/`), the Home Assistant add-on, the installers and
update scripts (`deploy/`), and casatorch.com's endpoints that CasaTorch talks to.

## At rest

Everything lives in one data folder (`CASATORCH_DATA_DIR`; `/var/lib/casatorch` on Linux, `/data` in Docker and
the add-on). It is created `0700`; every file in it is written `0600` through `writeFileSafe` (temp file, fsync,
rename). At start-up and hourly, `tightenDataModes` (00-setup.js) re-applies those modes to anything looser,
skipping `bin/` and never following links.

| What | Protection | Where |
|---|---|---|
| Master key `secret.key` | 256 random bits, `0600`. Created atomically and only if absent; an unreadable key stops start-up; a damaged one is renamed `secret.key.damaged-*`, never overwritten. | `loadKeyFile` / `keyOf`, 00-setup.js |
| Secrets in `config.json` | AES-256-GCM, 96-bit random nonce, 128-bit tag, format `v1.<iv>.<ct>.<tag>`. Keys named `token`, `refreshToken`, `apiKey`, `secret`, `password`, `clientSecret`, `privateKey`, `license`, `snapshotUrl` anywhere, plus `hue.username`, `dns.key`, `yolink.uaid`, `calendars[].url`. Plain-text files from older versions are sealed on load. | `seal`, `unseal`, `SECRET_KEYS`, `sealConfig`, 00-setup.js |
| Passwords | scrypt N=16384, r=8, p=1, 16-byte salt, 32-byte output; `timingSafeEqual`; same work for unknown users. | `hashSecret` (05-setup.js), `verifySecret` (08-signin.js) |
| TOTP secrets, Google client secret | AES-256-GCM (`seal`). | 08-signin.js, 68-app.js |
| Recovery codes | scrypt N=16384, 12-byte salt per code (`rc1$`). | `rcHash`, 08-signin.js |
| Sessions, invites, wall-panel links | Only SHA-256 of the 256-bit (sessions, panels) or 192-bit (invites) token is stored. | 08-signin.js |
| Push keys | VAPID private key, phone-app relay Ed25519 key and per-phone alert keys: AES-256-GCM. | 41-notify.js, 68-app.js |
| Secure address at home | Name secret sealed; certificate key and ACME account key generated on the box, `0600`. | 43-local-https.js |
| Backups | `CTBK1` file: scrypt(passphrase, N=32768, r=8, p=1, 16-byte salt) → AES-256-GCM over gzip; includes `secret.key`; excludes sessions. | 75-backup.js |
| Logs | In-memory ring buffer (600 lines) and stdout both masked: named secrets, Bearer/Basic credentials, `user:pass@` in URLs, long random strings. `audit.log` holds events only. | 00z-logs.js, `audit` in 08-signin.js |

Not encrypted beyond file permissions: home data (`history.json`, `alerts.json`, `events.json`, layouts,
`security.json`, `nudges.json`), photos, floor plans and scans, TLS private keys. Sealing them with a key stored
beside them would add little; full-disk encryption on the host is the control for device theft.

## In transit

- **LAN https:** `lan-<id>.casatorch.com` resolves to the box's private address; Let's Encrypt certificate via
  DNS-01 (casatorch.com sets the TXT record), key made on the box. `https.createServer` with `minVersion: TLSv1.2`
  on port 8443. Plain http on 8090 redirects browsers to https first (`go-secure.html`), and stays available as a
  fallback on the home network.
- **Headers** (01-security.js): CSP with hashed inline scripts (and `'wasm-unsafe-eval'` so the 3D home's WebAssembly
  decoders for compressed scans can run - JavaScript `eval` stays blocked), `frame-ancestors` limited to self and Home
  Assistant, `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `Permissions-Policy`,
  `Cross-Origin-Resource-Policy: same-site`, `Cross-Origin-Opener-Policy: same-origin-allow-popups` (none on the return page of the Home Assistant sign-in window), HSTS (180 days) over https,
  `Cache-Control: no-store` on `/api`. Host allow-list against DNS rebinding; Origin / Sec-Fetch-Site checks on
  every state-changing API call; cookies `HttpOnly; SameSite=Lax` plus `Secure` over https.
- **Outbound:** Node's TLS verification is never disabled globally. Exceptions: LAN network gear tests in setup
  (UniFi, Pi-hole, AdGuard), `74-network.js` for LAN hosts only, certificate *inspection* (monitors, Frigate
  trust-on-first-use), and Frigate itself, which is pinned by SHA-256 fingerprint. cloudflared is SHA-256 pinned.
  Requests to cloud metadata addresses are refused.
- **Phone app alerts:** AES-256-GCM per phone key; batch signed with Ed25519; the relay
  (`casatorch.com/api/push/send`) verifies the signature against the first key it saw for that home. Outside the
  ciphertext: home id, public key, push token, platform, critical flag, and an HMAC-derived opaque collapse tag
  (`pushTagFor`).
- **Web Push:** RFC 8291 (aes128gcm) with VAPID; endpoints limited to the known push services.
- **Secure access (not released yet):** Cloudflare Tunnel. TLS terminates at Cloudflare's edge; the tunnel to
  cloudflared is encrypted; cloudflared reaches CasaTorch over loopback. Basic installs only accept tunnel
  requests from the home's own public IP.

## Phone apps (not released yet)

iOS: tokens in the Keychain (`WhenPasscodeSetThisDeviceOnly` + `.userPresence` when the lock is on, otherwise
`AfterFirstUnlockThisDeviceOnly`); alert keys in a Keychain group shared with the notification extension; ATS
allows only local-network http. Android: tokens and alert keys sealed with AES-256-GCM keys in the Android
Keystore (the lock key requires biometric or device credential, 30 s validity); `allowBackup=false` plus
data-extraction rules excluding everything; clipboard copies marked sensitive.

## Updates

Linux, Pi and Box updates install only if `SHA256SUMS` carries a valid Ed25519 signature from the offline release
key and the package matches it (`deploy/packaging/linux/casatorch-update`). Pro keys are Ed25519-signed and
checked offline.

## Tests

`cd app && node test/unit.mjs` covers sealing, config secret coverage, key-file handling, data-folder modes, log
masking, password hashing, cookie flags, alert sealing/signing and security headers.
`tools/test-security.mjs` runs regression checks against a fresh server.
