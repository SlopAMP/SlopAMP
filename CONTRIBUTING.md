# Contributing to SlopAMP

Thanks for wanting to help! Bug reports, ideas and pull requests are all welcome. Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs

Open an issue with the **Bug report** template. The most useful reports include:

- the SlopAMP version (click **?** on the player) and whether it's the Setup or the Portable exe
- your Windows version
- what you did, what happened, and what you expected
- a screenshot if it's visual, and the file type or link that caused it (a YouTube link is fine; please don't upload copyrighted media)
- the log file if SlopAMP crashed or froze: `%APPDATA%\SlopAMP\slopamp.log` (Portable: `SlopAMP Data\slopamp.log` next to the exe). Look it over before attaching, since it contains file names from your PC.

**Security problems:** please don't open a public issue. See [SECURITY.md](SECURITY.md).

## Suggesting features

Open an issue with the **Feature request** template. Describe the problem you want solved, not only the solution. For anything with a visible UI change, a sketch or mockup helps a lot.

## Working on the code

SlopAMP is plain JavaScript on Electron, with no framework and no build step for the app itself. [BUILDING.md](BUILDING.md) explains how it's put together, how to run it from source, and how the installers are built.

Quick start on Windows:

1. Clone the repository.
2. Put FFmpeg in `vendor\ffmpeg\win32\` (see BUILDING.md), and optionally yt-dlp in `vendor\ytdlp\win32\`.
3. Run `npx electron@41.2.0 .`

A few house rules:

- **Windows:** the player, equalizer, video and playlist each live in their own window. In `src/renderer/app.js`, find elements with `$` / `$$` and listen with `WM.onDocs` / `WM.onWins` instead of using `document` directly (BUILDING.md explains why).
- **Look and feel:** colours, fonts and sizes belong in `src/renderer/theme.css` as CSS variables. Don't hard-code them in `style.css`, `frame.css` or the JavaScript.
- **Security:** keep `contextIsolation`, `sandbox` and the Content-Security-Policy as they are. Don't add `eval`, remote scripts (other than YouTube's player API) or new network calls without explaining why in the pull request.
- **Dependencies:** SlopAMP has no npm dependencies at runtime. Please talk to us in an issue before adding one.
- Keep pull requests focused: one fix or feature each.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change and test it on Windows 10 or 11 if you can. Check that local files, a YouTube link, the equalizer, the visualizer and moving the windows around still work.
3. Fill in the pull request template. Screenshots are very welcome for UI changes.
4. A maintainer will review it. Small follow-up changes may be requested.

The maintainers update `CHANGELOG.md` and the version number when they make a release, so you don't need to.

## License

By contributing, you agree that your contribution is released under the project's [MIT License](LICENSE).
