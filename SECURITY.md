# Security Policy

## Supported versions

Security fixes go into the newest release. SlopAMP updates itself (or tells you about the update, for the portable exe), so please stay on the latest version.

| Version | Supported |
| ------- | --------- |
| 1.3.x   | Yes       |
| < 1.3   | No: please update |

## Reporting a vulnerability

**Please don't report security problems in public issues, pull requests or discussions.**

Report them privately through GitHub's private vulnerability reporting:

1. Open the [**Security** tab](https://github.com/SlopAMP/SlopAMP/security) of this repository.
2. Click **Report a vulnerability** (or go straight to <https://github.com/SlopAMP/SlopAMP/security/advisories/new>).
3. Fill in the form. Only you and the maintainers can see it.

Helpful things to include:

- the SlopAMP version and whether it's the Setup (installed) or Portable exe, plus your Windows version
- what an attacker could do, and what they'd need (a crafted media file or playlist, a link, local access…)
- steps to reproduce it, or a proof of concept
- any idea for a fix, if you have one

## What to expect

- We aim to reply within a week to confirm we've got your report.
- We'll keep you updated while we work on a fix, and agree with you on when the details go public.
- Once a fixed version is released, we publish a security advisory and credit you, unless you'd rather stay anonymous.

## Scope

In scope: SlopAMP itself, meaning the app, its local media server (127.0.0.1 only), the auto-updater, and the Setup and Portable installers.

Problems in the bundled third-party programs (Electron/Chromium, FFmpeg, yt-dlp, Butterchurn) should go to those projects. Tell us as well if SlopAMP needs an updated copy.
