# Security

CasaTorch runs in your home and keeps your home's data there. This file is our security policy: how to report a
problem, which versions get fixes, and a short summary of how CasaTorch protects your data. The user-facing
version, with a diagram and what to do if something is lost or stolen, is in the docs:
**Help › Security and encryption**.

## Reporting a vulnerability

E-mail **support@casatorch.com** with "Security" in the subject. <!-- scrub-ok: public support address -->
Please include what you found, steps to reproduce, and the version you tested (Settings › Updates). Don't open a
public issue, and don't test against homes that aren't yours. We'll reply, keep you posted while we fix it, and
credit you in the release notes if you'd like.

In scope: the CasaTorch server, the phone apps, the Home Assistant add-on, the installers and update scripts, and
the casatorch.com services that CasaTorch talks to.

We fix security issues promptly and ship fixes through the normal automatic updates. Please give us a reasonable
chance to fix a problem before you talk about it publicly.

## Supported versions

| Version | Security fixes |
|---|---|
| The latest release | Yes |
| Older releases | No - please update to the latest release |

The CasaTorch Box, the Raspberry Pi image and the Linux package update themselves overnight. Other installs show
when an update is available; please install it promptly.

## How your data is protected, in short

- **Your data stays at home.** Settings, history and sign-ins live on your CasaTorch, readable only by CasaTorch
  itself. There is no CasaTorch account and no cloud copy of your home.
- **Secrets are encrypted at rest** with AES-256-GCM, using a key unique to each CasaTorch that never leaves it
  (except inside a backup you make) - saved passwords and keys, the secure address's private keys, voice pairings,
  the Home AI Agent's chats, the event timeline and the pictures it keeps, and copies of your Frigate settings.
- **Passwords are never stored**, only salted scrypt hashes. Recovery codes, invite links and sign-in tokens are
  stored only as hashes.
- **Encrypted in transit.** At home, browsers reach CasaTorch over https (TLS) with a real certificate made on the
  box. Every connection to an online service is https with the certificate checked.
- **Phone alerts are end-to-end encrypted** for each phone and signed by your CasaTorch; casatorch.com and the push
  services carry them but can't read them.
- **Backups are encrypted** with AES-256-GCM using a key derived from your passphrase. We can't open them. Each one is
  opened again and checked before you download it, and **Check a backup file** tells you whether a file restores,
  without changing anything.
- **Updates and Pro keys are signed** (Ed25519) and checked on the box before they are used. An update is installed
  only when its signature is CasaTorch's offline release key and it is newer than the version installed; without the
  key, or for an older release, nothing is installed. Installers refuse a release whose signed file list is missing.
- **casatorch.com can't reach into your home.** There is no remote command channel and no settings push: casatorch.com
  only answers requests your CasaTorch makes. Secure access's tunnel reaches this CasaTorch and nothing else on your
  network - its rules are written on the box, and if Cloudflare's side of the tunnel is ever told to send visitors
  anywhere else (your router, Home Assistant, another computer) or to route into your network, CasaTorch stops secure
  access at once, writes it to the security log and alerts you. A visitor through the tunnel is always treated as
  someone away from home.
- **No install scripts.** Packages CasaTorch uses never run their own scripts when installed - on the box, in the
  installers or in CI.
- **Sign-in is protected** with per-person accounts and roles, optional (or required) two-step sign-in, limits on
  guessing, and a security log.
- **No open ports.** CasaTorch never asks you to open a port on your router.
- **Safety:** CasaTorch and its AI never unlock doors, open garage doors or gates, or disarm alarms.

Every change goes through automated security and attack testing before it's released.

## Keeping your CasaTorch safe

Keep it updated, use a strong password, turn on two-step sign-in, use the secure address at home rather than the
plain http address, and turn on disk encryption on hardware you run it on yourself.
