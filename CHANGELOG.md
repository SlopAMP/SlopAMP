# Changelog

## 2.4.0 — unreleased

- **Share playlist** (idea #5): right-click a playlist tab → **Share playlist (.zip)…** (also Library → PLAYLISTS → right-click → Share (.zip)…). One .zip with the playlist and its songs and videos, so a friend gets everything: `<name>.m3u8` plus a `<name>` folder with the files numbered in playlist order (any player can open it once unzipped). YouTube / X links stay links; "Also include my downloaded copies" puts those files in too. Shows the size and any missing files first; saved in `Downloads\SlopAMP\Shared` (Change… picks another place); files are stored as they are (no recompressing, any size); Cancel leaves nothing behind.
- **Opening a shared .zip**: drop it on SlopAMP, LOAD it, or Open with → SlopAMP. It unpacks into `Downloads\SlopAMP\Shared\<name>` (a new folder, never over anything; only songs, videos and playlists come out) and opens as a new tab.
- **Open with SlopAMP** (idea #6): double-clicking / Open with on a .m3u8, .m3u or .pls now opens it in a new tab named after the file and starts playing (before, SlopAMP ignored a playlist handed over that way); the same file again switches to its tab, also after a restart. The installer registers SlopAMP as a playlist app (so Windows' Default apps lists it); **"?" → Make SlopAMP open playlists…** does the same for the current user (also the Portable copy) and opens Default apps, where you pick SlopAMP once.
- **Library → SKINS** (idea #21): every skin has its own buttons: **Apply** (✓ ON on the skin you have on), **✎ Edit** and **🗑 Delete** for yours; **Apply** and **✎ Edit a copy** for the built-ins (🔒, they can't be changed or deleted). **⋯** (or right-click): Rename… / Export… / Show in Explorer (SlopAMP Classic can be exported now too). Enter applies, Del deletes the selected ones of yours; a row's Delete deletes just that skin and says when it's the one you have on. Edit while the Skin Editor has unsaved changes asks Save / Discard first. The header counts both ("2 SKINS OF YOURS · 9.6 KB · 10 BUILT-IN"); a narrow Library hides file / size / date before any button.
- **Mini mode** (idea #20, replaces the mini player): Layout → Mini mode or **Ctrl+M** (M and the ▭ button too) turn the player into one always-on-top bar: ⏮ ▶ ❚❚ ■ ⏭, the title (scrolls when long), the time, a volume slider and ⤢. Drag it anywhere (remembered); double-click, ⤢ or Ctrl+M for the full player with every window back where it was. A playing video keeps its window where it is; fullscreen from the bar returns to it; the lightning bolt, Reset layout and picking a layout leave mini mode first; quit in mini mode and SlopAMP starts in it.
- **Tray and media keys** (idea #19, in "?" and the Layout menu): **Minimize to the tray** (off at first): – (or the taskbar) hides every SlopAMP window next to the clock; the tray icon (only there while SlopAMP is in the tray) shows the song, brings everything back on a click, and has Previous / Play-Pause / Next / Stop / Show SlopAMP / Quit; a new version shows as a tray note. ✕ still quits. **Use media keys** (on at first): the keyboard's media keys keep working in the background as before; off, SlopAMP leaves them to other players (complete after a restart).
- Fixes: the Library's CLIPS filter line showed under the SKINS search when you came from CLIPS (bug #2).

## 2.3.1 — released Oct 29, 2026

- **The old SLOP code is gone** (idea #17; hidden since 2.3.0): the SLOP window and its button code, LOOK, packs, the YouTube stream trim, the prompt / lyrics.txt, motion.mp4, Zip pack and Open in slop.cc are removed from the app. All editing is CLIP from now on: MP3 / MP4 clips, SHOTS (with Burst ×5), the EDIT button and Library → CLIPS work as in 2.3.0. Your existing packs stay in `Downloads\SlopAMP\Slop` (SlopAMP never deletes that folder; open it in Explorer). A saved layout from an older version that still has the SLOP window in it loads fine.
- **Lightning bolt** (idea #18): always brings back **Classic (stacked)**. The one exception: when **Classic (stacked, No EQ)** was the last layout you picked in the Layout menu, the bolt brings that back, with the EQ hidden and no gap (also after you've moved a window, and after a restart). EQ / E under No EQ switches to Classic (stacked), so the bolt then shows the EQ. Its tooltip says which one you'll get. Reset layout (Ctrl+Alt+R) is unchanged: everything back, EQ included.
- Fixes: with Classic (stacked, No EQ), moving a window and restarting SlopAMP brought the EQ back; it stays hidden now. CLIP's waveform redraws in the new colours when you change skins.

## 2.3.0 — released Oct 29, 2026

- **CLIP** (ideas #12 / #13): cut a piece out of a song or video and save it as a new MP3 or MP4, in its own SlopAMP window (like SLOP). Right-click a song or video in the playlist (also YT / X History) or the Library → **Clip MP3…** / **Clip video…**; a YouTube or X item that isn't downloaded yet is downloaded first, then CLIP opens. Layout → CLIP opens it empty (Clip what's playing, Pick a file…, or drop a file on it).
- In / Out on a waveform with green handles (drag the edges or the clip, drag a new range, type times, ±0.1 s), zoom, a preview with a strip of frames for videos, Play clip / Loop / short previews around each edge. The preview plays inside CLIP and pauses SlopAMP's player. Space, I / O, G (a shot) and ← → work on CLIP only while its window is the active one.
- **MP3**: same quality as the file (an MP3: no re-encode) or 320 kbps (needed for Fade in 0.5 s / Fade out 2 s). **MP4** (H.264 + AAC, same size): Exact cut (re-encodes, starts on the frame picked) or Fast cut (copies, H.264 .mp4 only, may start a few seconds early); "Also save the sound as MP3". The original file is never changed: clips are new files in `Downloads\SlopAMP\mp3clips` / `Downloads\SlopAMP\mp4clips`, named "Title (0m26s-1m26s)", and can go straight into the playlist.
- **Library → CLIPS**: every clip with its length and what it was cut from (All / MP3 clips / MP4 clips); play, add to a playlist, **Clip again…** (same In / Out on the original), rename, delete (Recycle Bin). ALL lists clips too. The Library rows have a right-click menu now (play, add to a tab, clip, show in folder, delete).
- **YOUTUBE window**: the YOUTUBE button (bottom right of the playlist) or Layout → YOUTUBE opens youtube.com in a SlopAMP window. The stack moves to the left edge and YouTube fills the rest of the screen (at least 800 px wide; on small screens it overlaps instead); closing it puts the stack back. Drag the address (or a thumbnail) onto a playlist tab or row, or **+ Add to "Main"** (▾ picks the tab) / **▶ Play in SlopAMP**. No double audio. Only YouTube opens there (other links go to the normal browser); its own sign-in, with a fallback to the normal browser. A link dropped on a playlist tab now goes into that tab.
- **EDIT** (the player's SLOP button, renamed): opens CLIP on the selected song or video, else the one playing (as MP4 when it has a video file, else MP3; switch in CLIP). A playing local file starts the preview where it's playing; click again to close. Not downloaded yet: a small menu (Clip MP3… / Clip video…, downloaded first). Right-click EDIT: Clip MP3 / Clip video, Library → CLIPS.
- **SHOTS in CLIP** (SLOP's LOOK, moved): an optional section for videos, one line until you use it. **+ Shot** (or G while CLIP is the active window) saves the frame the preview shows, full size, from the file; **Burst ×5** grabs 5 across the clip and you keep the good ones; name, kind (person / look / prop / place) and ★ Lead go into the file name (`ref-01 Singer (person).png`); ◀ 1 s / ↻ / 1 s ▶ grab it again; delete (Recycle Bin). Saved in `Downloads\SlopAMP\Shots\<video title>`.
- **SLOP is hidden** (nobody used it; CLIP's trimmer replaces its audio editing and SHOTS its reference frames): no button, menu item or Library SLOP tab, and G / I / O while watching no longer make SLOP packs. Its code stays and your packs stay in `Downloads\SlopAMP\Slop` (open them in Explorer); nothing is deleted. Gone with it for now: clipping a YouTube stream without downloading, the second clip / whole song extras, the prompt and lyrics.txt, motion.mp4, Zip pack and Open in slop.cc.
- **Layout → Classic (stacked, No EQ)**: the classic stack with the EQ window hidden (the EQ itself keeps working). Remembered next time; EQ / E puts the EQ back (Classic (stacked)); Classic (stacked) shows it again.
- Fixes: the Library's selected row and its type tags were hard to read in the Chrome and Pocket skins.

## 2.2.0 — 2026-10-28

- **YouTube History** (idea #7): a built-in first tab, **YT History**, that fills itself with every YouTube video you play (also downloaded copies of YouTube videos; not your files, not X posts; a video that couldn't play isn't added). Rows show when you watched (now, 12m, 3h, yday, Mon, Oct 19); the length is in the tooltip. A strip at the top says what it's doing: "Recording · newest first · keeps 100 · replays move up".
- **Settings** (⚙ on the strip, or right-click the tab): Record YouTube plays; Keep a synced copy in Playlists (`Downloads\SlopAMP\Playlists\YouTube History.m3u8`, on by default); Order: newest / oldest at the top; When a video plays again: move it up to newest / leave it where it is / add it again; Keep: last 50 / 100 / 250 / 500 / Custom… / No limit (keeping fewer asks first); Save a copy as playlist file…; Clear history…; Restore default options.
- Saved silently with your session, no pop-ups. Videos played from inside History only get a new time; History isn't reshuffled. SAVE ALL skips History; nothing can be pasted, dropped or moved into it; dragging rows out copies them. Recording off + Clear history hides the tab; Layout → YouTube History brings it back.
- **X History** (idea #11): a second built-in tab, **X History**, right after YT History. An X post goes in only when its download finishes (video or Audio only MP3) — not on Play on X, Skip, or a download that failed or was canceled. Rows show when you downloaded it (or last played it); right-click → **Open in browser** opens the post on X, and the downloaded files stay linked so it plays here.
- X History has the same settings as YT History: Record X downloads; synced copy `Downloads\SlopAMP\Playlists\X History.m3u8` (on by default); Order; When a post is downloaded again: move it up / leave it / add it again; Keep 50 / 100 / 250 / 500 / Custom… / No limit; Save a copy…; Clear history…; Restore default options. Same rules too (SAVE ALL skips it, nothing can be added by hand, dragging out copies). Recording off + Clear history hides the tab; Layout → X History brings it back.
- Fix: greyed-out menu items were nearly invisible in some skins (Terminal); they're readable in all ten now.

## 2.1.1 — 2026-10-26

- **Skip counts down** on the X choice (Play on X / Download / Skip) and on YouTube videos that can't play here (Open in browser / Download / Skip, and "YouTube is unreachable", which now has Skip too): **Skip (10) … Skip (0)**, then it moves to the next item. Any button stops the count; it waits while the download menu is open; once a download of that item starts, the box waits for it (an X post plays when it's done). A failed download brings the choice back with the reason.
- The playlist no longer passes over X posts that aren't downloaded without asking: it shows their choice, and Skip's countdown keeps it moving.
- Skip with Repeat one on goes to the next item instead of trying the same one again. No countdown on the last item when there's nothing after it; after a whole round with nothing playable, the countdown stops.

## 2.1.0 — not released on its own (shipped in 2.1.1, 2026-10-26)

- **X video links in playlists.** Drag, paste or +URL x.com / twitter.com posts (also fxtwitter, vxtwitter, fixupx and t.co links); playlist files can hold them too. They get an **X** tag like YT / YTM.
- X videos can't stream inside SlopAMP, so an X item plays after it's downloaded. Playing one that isn't saved shows **Play on X** (opens the post in your browser) / **Download** / **Skip**; a download started there plays as soon as it's done. When a track ends, X posts that aren't saved are skipped.
- **DOWNLOAD** and **DOWNLOAD ALL** work for X posts with the same choices as YouTube (Best / 1080p / 720p / 480p, Audio only MP3), into the same Video and Audio folders; the Library lists them. Right-click an X item: Download…, Open in browser. A post with several videos: the link ending in /video/2 etc. picks one.
- Clear messages when an X post has no video, needs a signed-in account, or was deleted.
- Fixes: messages over the video (YouTube errors, the X choice) were hard to read in the Chrome skin; playlist tags are easier to read in every skin, also on selected rows.

## 2.0.0 — 2026-10-25

The Skin Editor release (tested as 1.7.0). SlopAMP 1.4.4 stays available as the classic version without SLOP.

- **Skin Editor** (its own window: "+ New skin" in the SKINS picker, or "Skin editor…" in the Layout menu). Start from any skin, built-in or yours, and move its colours in families: LCD & accent, player body & frames, buttons, menus & screens, text, warnings, danger, selection. Each family has Hue / Saturation / Brightness and a colour picker for its main colour; "Each colour" changes one at a time. Every window shows the change as you drag. **Reset all**, per-family **reset**, and a warning when text gets hard to read.
- **Your own skins:** **Save as** writes `Downloads\SlopAMP\skins\<name>.css` (its own folder, next to Video, Audio, Playlists and Slop); **Save** updates a skin of yours. They show under **Mine** in the SKINS picker and are remembered like the built-ins. Closing the editor without saving puts your skin back. The lightning bolt and Reset layout still never change the skin.
- **Library → SKINS:** your skins and the built-ins, with Apply, Edit, Rename, Export, Show in Explorer, Delete (Recycle Bin), Import and Open skins folder. Built-in skins can't be changed or deleted (Edit starts a new skin from one). Deleting the skin you have on goes back to SlopAMP Classic.
- **Import / Export** share a skin as one .css file. Imported files are cleaned first: nothing in them can load anything from the internet or run code.
- Skins made with the 1.7.0 test build (in `Downloads\SlopAMP\Slop\skins`) move to `Downloads\SlopAMP\skins` by themselves; the Slop folder is for packs only. Hovered cards in the SKINS picker stay readable in every skin.
- Smaller download: the app now carries English Chromium UI strings only (about 46 MB less installed). Installing over an older SlopAMP removes the other language packs it left.
- **Library:** follows Layout → Keep windows on top (the 1.7.0 test build that first did this showed the Library as a blank black window on Windows; fixed). With it off, the Library stays above SlopAMP's windows but no longer above other apps (Explorer, your browser). The tabs are grouped: ALL / VIDEO / MP3 / PLAYLISTS (ALL is those three), then SLOP and SKINS.

## 1.6.0 — 2026-10-25

- **SLOP is now its own window** (the 5th SlopAMP window: it moves, snaps and resizes like the others). The video keeps playing while you build a pack; the window's clock follows the player. **G** grabs the frame on screen, **I** / **O** set where the clip starts and ends, in any SlopAMP window, even with SLOP closed.
- **Audio:** the song is downloaded once (with **Stop** / **Start**), then the clip, a **second clip** (audio-2.mp3) and the **whole song** (song.mp3) are cut on your PC, instantly and without asking YouTube again. A **waveform** shows the song: drag the clip's edges or the whole clip, drag on the wave for a new clip, or type the seconds before/after the moment (both stay in sync); a click jumps the player there. Videos over 20 minutes: only 3 minutes either side of the moment are downloaded.
- **Look:** a bigger preview and **several frames** per pack. Each frame gets an optional **name** and a **kind** (person / look / prop / place), which go into its file name (`ref-01 Singer (person).png`), the way slop.cc's reference bank names references. **★ Lead** is always ref-01. **Burst ×5** grabs five candidates across the clip to pick from (Lead / Ref / skip). Optional **motion reference**: a silent 2–5 s `motion.mp4` around the lead frame, 1080p H.264.
- **Prompt:** **Copy** and **Save prompt.txt** under the text (prompt.txt ends with a short rights note; the clipboard gets the prompt only). A **suggested scene line** from the video's title and description, also in source.txt (with the YouTube ID). YouTube **captions** for the clip are saved as `lyrics.txt` when the video has them.
- **Pack:** **Open in Slop.cc** opens slop.cc's "new video" page and the folder and copies the prompt. **Sign up / sign in at slop.cc**, **Zip pack** (one .zip next to the folder, for sharing or backup) and **Discard pack**. Each pack has a `pack.json` describing what's in it.
- **Library → SLOP:** a media manager for your packs, with grid and list views, search (titles, reference names, prompts, lyrics), filters (person / look / prop / place, song, motion, lyrics, zipped, not opened yet), a preview with every reference and the audio to play, rename, open in SLOP, open in slop.cc, zip, show in Explorer, delete and delete all (Recycle Bin), multi-select. Packs made by 1.5 show up too and are upgraded when opened. The Library window can be resized.
- Windows: SLOP opens beside the player's windows; Reset layout and the layout presets keep it on screen. Layouts saved by earlier versions are kept as they were.

## 1.5.1 — 2026-10-24

- Slop: frame.png is now always the full-size frame from the video itself (up to 1080p). In 1.5.0 the video window's picture was saved first, and when the frame from the video didn't come it stayed, so a 1080p video could end up as a 640×360 frame with a warning.
  - The video window's picture is only a preview now ("PREVIEW"); **Open in Slop.cc** waits for the frame from the video.
  - The frame is fetched the same way as the audio clip (yt-dlp gets one second of the video from that moment, FFmpeg takes its first frame, no re-encoding), with the 1.5.0 way as a fallback.
  - If it still can't be had, the box says so with the reason, and **Re-grab** tries again. Using the window picture instead is your choice, labelled as the window picture.
  - "Low resolution" is only said when the video's own frame is under 512 px.
- Skins: every skin file now names its warning colour (`--warn-ink`); six of them used Classic's without saying so.

## 1.5.0 — 2026-10-24

- **SLOP button** (next to FULLSCREEN, while a YouTube video plays) opens **Slop this moment**, one box that gets a moment ready for slop.cc. Playback pauses while it's open and continues where it was when you close it.
  - **Audio clip:** an MP3 from 15 s before to 45 s after the moment (both numbers editable), made with the same downloader as DOWNLOAD. A pill shows its progress.
  - **Look:** the frame you're watching, taken straight from the video (up to 1080p, without player buttons or overlays). It shows the video window's picture first and swaps in the sharp one a second later; if YouTube doesn't answer, the window picture is kept. **◀ 1 s**, **Re-grab** and **1 s ▶** pick the frame. Frames under 512 px get a warning, because slop.cc warns about them.
  - **How do you want to slop this?** Roast, Remake, Music video or Custom, plus your own text.
  - **Open in Slop.cc** says what leaves SlopAMP (this audio clip, this frame, your text), then opens the folder and slop.cc/chat in your browser and copies your text. You attach audio.mp3 and frame.png and paste the text on slop.cc yourself; SlopAMP uploads nothing.
- Each moment is kept in `Downloads\SlopAMP\Slop\<date> <title> @<time>\` with `audio.mp3`, `frame.png`, `prompt.txt` and `source.txt` (the video link and time). Cancel removes a folder you never opened.
- DOWNLOAD, SLOP and FULLSCREEN fit side by side in the 420 px player in every skin.
- Skins: a new warning colour (`--warn-ink`) keeps warnings readable in dialogs, including in the Chrome and Pocket LCD skins.

## 1.4.4 — 2026-10-23

- The update bar under the player now uses the same words as the About box button: **Install update…** when a new version is found, **Downloading… N%** while it downloads, **Verifying…** while the download is checked, and **Restart and install** when it's ready.
- In "Install automatically" mode the bar says **Downloading 1.4.x in the background… N%**, so you can see the download has started by itself. SlopAMP still asks before it restarts.
- The download progress is now a thin line along the bottom of the bar, and **Cancel** is a link. The text no longer gets cut off at the default 420 px width (before, "42 of 155 MB" showed as "42 of 155 …").
- **Cancel** during a download now always stops it and goes back to "Install update…". (With a local test release, as used for testing updates, Cancel used to be ignored.)

## 1.4.3 — 2026-10-23

- About box: the button under the update status now says what clicking it will do. Once an update is found it reads **Install update…** (opens What's new, where you confirm), while downloading it shows the progress, and when a downloaded update is verified it reads **Restart and install**. The portable exe shows **Download page**, and after a failed download it reads **Try again**. While SlopAMP is busy, the button shows what it's doing and can't be clicked: **Checking…**, **Downloading… N%**, **Verifying…** and **Installing…**.
- About → Check for updates: the first click that finds a new version now opens What's new right away. Before, it only changed the status line and you had to click a second time.
- The status line says "ready to install" once a downloaded update is verified.

## 1.4.2 — 2026-10-23

- About → View licenses: the third-party notices are readable in the Chrome and Pocket LCD skins (dark text on a light box, like the other skins). Their box used to come out black or dark green.
- 1.4.0 and 1.4.1 were test builds only; everything below is part of this release.

## 1.4.1 — 2026-10-23

- The skin picker is now a small movable panel: drag it by its title, and it reopens where you left it (also after a restart), always fully on screen. It has a ✕ button (Esc works too) and stays open while you try skins. This works the same from the SKINS button and from Layout → Skins….
- The version label next to the green dot is a little bigger and easier to read.
- The update setting in the About box ("When a new version is out") is readable in every skin, both closed and open. Its list used to show dark text on black in some skins.

## 1.4.0 — 2026-10-22

- **Skins.** Ten built-in skins that restyle all four windows (player, equalizer, video/visualizer and playlist), menus and dialogs:
  - five colours of the standard look: **SlopAMP Classic** (green, the default), **Red Alert**, **Ice Blue**, **Purple Haze** and **Amber**;
  - five styles with the same window shapes: **Chrome** (light brushed metal), **Walnut Hi-Fi** (wood cabinet, warm orange displays), **Synthwave** (purple, pink and cyan), **Terminal** (flat black, phosphor green, monospace, faint scan lines) and **Pocket LCD** (four shades of olive green).
- New **SKINS** button on the player (between REPEAT and the lightning bolt), also in the Layout menu as **Skins…**. The picker shows a preview of every skin; clicking one switches instantly, no restart.
- Your skin is remembered between launches. The lightning bolt and Reset layout only move the windows and never change the skin.
- Every colour, glow, border and background now comes from the skin file (`src/renderer/skins/`); the clock digits, spectrum, EQ curve and BARS visualizer follow the skin too. All ten skins were checked for readable text in every window, menu and dialog.
- The player shows its version number ("v1.4.0") next to the green dot, read from the app itself so it's always current.

## 1.3.0 — 2026-10-22

- **Movable windows.** The player, equalizer, video/visualizer and playlist are now four separate windows. Drag any of them by its title bar; they snap to screen edges and to each other (edge to edge, never overlapping), with a green glow on the edges that snap.
  - Moving the player moves every window snapped to it; pull a window away to use it on its own, for example the visualizer on a second monitor or TV.
  - Resize the video and the playlist with the grip in their corner (or their right/bottom edge); the player and equalizer can be made wider. Windows docked underneath follow when a window grows, shrinks, rolls up or closes.
  - Every window has **–** (roll up to the title bar; double-clicking the title bar does the same) and **✕**. The playlist now has its own title bar too. EQ / VIS / VID / PL on the player bring windows back.
  - **Layout menu** (right-click any title bar, or the new ⧉ button on the player): *Classic (stacked)*, *Playlist beside player*, *Big visualizer*, *Snap to edges & windows*, *Keep windows on top* and **Reset layout** (Ctrl+Alt+R), which brings every window back to the middle of the main screen. SlopAMP also resets the layout by itself if a window ends up off screen, for example after unplugging a monitor.
  - Window positions and sizes are remembered between launches. The first launch of 1.3 builds the layout from your 1.2 window size and playlist height.
  - Menus and dialogs (About, Library, download menu, presets…) open in their own small windows, so they're never cut off by a small window.
  - The visualizer keeps its own controls (presets, favorites, BUTTERCHURN/BARS, fullscreen) when it's on its own, and fullscreen now fills the screen with just the video window.
- **Ready for skins (coming in 1.4):** every colour, font and size now lives in one theme file (`theme.css`), the window frames are separate from the player and playlist code, and the saved layout has a `skin` setting.
- The lightning badge now means "back to normal": it leaves fullscreen or the mini player, brings back the video and playlist, and docks the windows under the player.
- New GitHub community files: Code of Conduct, Contributing guide, Security policy (report vulnerabilities privately through GitHub), and bug report, feature request and pull request templates.
- The exe's copyright line now reads "SlopAMP (@HeyoPatriot)".

## 1.2.0 — 2026-10-20

- **Auto-updates**: SlopAMP checks GitHub once a day for a new version. Pick **Notify me** (default), **Install automatically** or **Off** in the About box (?), which also has **Check for updates**. A bar under the deck shows what's going on, and **What's new** shows the release notes before anything is installed. The installer comes from the official GitHub release, its SHA256 is checked against the release notes, and it installs silently, keeps your playlists and settings, and reopens SlopAMP. Automatic mode downloads in the background and then waits for you to click **Restart now**. The portable exe tells you about new versions and opens the download page.
- Fixed: uninstalling deleted the whole install folder, including files that weren't SlopAMP's if you installed into a shared folder. It now removes only SlopAMP's own files and leaves the folder if anything else is in it.
- Fixed: closing SlopAMP could leave it running invisibly in the background (seen with 1.1.1 Portable), which then blocked installing. Closing now always quits every SlopAMP process, starting SlopAMP twice no longer leaves a hidden copy, and Setup closes a stuck or hidden SlopAMP by itself (asks it to quit, then ends it after 10 seconds) instead of repeating "Please close SlopAMP".

## 1.1.1 — 2026-10-20

- **SAVE ALL** button (Ctrl+Alt+S): quick-saves every playlist tab to `Downloads\SlopAMP\Playlists` in one click.
- New **About** box: big SlopAMP logo, links to slopamp.com and GitHub, and a working **View licenses** button (the license viewer used to show a blank white box).
- Security hardening: the built-in media server now ignores requests that don't come from SlopAMP itself, its UI-file check is stricter, and a leftover testing switch in the downloader was removed.
- License/credits now read "SlopAMP (@HeyoPatriot)".

## 1.1.0 — 2026-10-18

First public release.

- New name: **SlopAMP** (settings and downloads from earlier test builds carry over automatically).
- **Playlist tabs**: rename, duplicate, reorder, drag songs between tabs; playback stays in its own tab.
- **Butterchurn visualizer** for music: 1,731 presets, search, favorites, auto-change, N/P/K/H keys, its own minimize/close bar; classic BARS still available.
- **Manage Library**: downloads and saved playlists in one window, with filters, search, sorting, open-in-tab and delete (Recycle Bin).
- **Playlists folder** (`Downloads\SlopAMP\Playlists`) and **Quick Save** (Ctrl+Shift+S).
- **Download All** for a whole tab; downloaded files are re-found from the folders if the app loses track.
- **Resume where you left off** (items 5 min+), **speed** 1×–3×, **subtitles**, **keyboard media keys**.
- Compact 420 px default size; the lightning badge restores it.

## 1.0.0

Private test builds: retro deck + video pane + playlist, local files via FFmpeg, YouTube links, equalizer, downloads with yt-dlp, fullscreen and mini player.
