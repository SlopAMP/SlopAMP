# Changelog

## 2.9.6 — unreleased

Hotfix: big playlists no longer freeze SlopAMP.

- **Adding many files shows them at once.** Adding a folder (or a drop, or Add files…) with more than 50 files used to show nothing until SlopAMP had read every file (one ffprobe per file), which took minutes for 1,500 songs. Now the rows appear right away with their file names, and the titles and lengths fill in as they're read, 100 files at a time. A line under the playlist says **Adding 340 / 1,500…** with **Cancel** (the rows stay; they keep their file names). Adds of 50 files or fewer work as before.
- **MP3s are read much faster.** An MP3's title and length now come straight from the file's tags and first frame, without starting ffprobe (same results); other files still use ffprobe.
- **Loading a big playlist** (LOAD, the Library's Open in new tab, double-clicking a playlist file) shows it at once with the titles and lengths saved in the playlist, and reads the files in the background (**Loading … / …**).
- **The Library opens at once, even with big saved playlists.** To show "▶ in <playlist>", the Library read every file of every saved playlist before it opened (1,500 ffprobes for a 1,500-song playlist) — the LIBRARY button and Library → CLIPS seemed to do nothing for a minute or more. It now reads only the playlists' file lists. It also opens straight away and fills in, LIBRARY blinks while it does, and LIBRARY on an open Library brings it to the front. The download-size check that uses the same list is quick again too.
- The list is drawn once per batch and the settings are saved once at the end. Files whose length was never read (SlopAMP closed during an add, or Cancel) are read in the background after the next start.
- Test: `tests/big-playlist-296.js`.

## 2.9.5 — released Nov 10, 2026

CLIP editor, part 2. Still only the FFmpeg inside SlopAMP; the original is never changed and every convert is a new file.

- **Convert tab in CLIP: convert a whole file, no trimming.** Turn on **Convert the whole file** (or pick a preset) and Save becomes **⇄ Convert**: the whole video or song as MP3, MP4 or GIF, in Downloads\SlopAMP\Converted, with the same line above Save (what you'll get, RE-ENCODE, about how big). Setting In / Out, a length preset or dragging on the wave switches back to clipping.
  - MP4 presets: **For X** (H.264 + AAC, fitted to X's 1920×1200 / 1200×1900, up to 60 fps), **Small** (720p, smaller), **Phone-friendly** (up to 1080p, 30 fps), **Best quality** (keeps size and frame rate, high bitrate). Size (Keep / Fit X / 1080p / 720p / 480p), Frame rate (Keep / 60 / 30) and Quality can be changed; it never upscales. The preset used last is remembered.
  - MP3: 320, 192 or 128 kb/s. GIF: the same settings as GIF clips.
  - **Fit under** 10 / 25 / 50 MB or the X limit: SlopAMP aims just under it (if it must, at a lower frame rate or a smaller picture) and tries once more lower if the file still comes out too big; if it's still over, the note says so.
  - Shape, Sound and Speed apply to a converted file too.
  - Library → right-click a converted file → **Convert again…**
- **For X knows your X account.** The first time you use For X, SlopAMP asks once whether your X account is **Free** or **Premium** and remembers it (Settings → YouTube & X → My X account to change it). Free: up to 2:20 and 512 MB. Premium: up to 4 hours and 16 GB on the web and iPhone, 10 minutes in X's Android app.
- **The For X bar.** When a video is over the limit, an amber bar above Save says exactly by how much ("2:30 is 0:10 over the 2:20 X allows on Free") with a one-click fix: **Trim to 2:20** (or 10:00 for Android) or **Lower the quality to fit**. It shows for For X converts and for MP4 clips (it replaces 2.9.4's 2:20 note). GIFs get their own: over 15 MB (X on the web) or 5 MB (X's phone apps), with **Trim to fit** and **Make it smaller**. It never stops you saving.
- **X's limits live in one place** (src/renderer/xlimits.js): CLIP, Convert, Fix for X and the X tags all read them, so a change by X is one edit.
- **Library quick filters.** ALL has All · Video · Audio · GIFs · Clips · Converted, with counts (counted once per refresh, so big libraries stay quick). Video and Audio include clips and converted files of that kind. The one you pick is remembered. CLIPS gets a **Converted** chip next to GIFs.
- Tests: `tests/xlimits-295.js` (the limit math, no Electron), `tests/clip-295.js`.

## 2.9.4 — released Nov 9, 2026

CLIP editor, part 1. Everything uses the FFmpeg already inside SlopAMP; the original file is never changed and every save is a new file.

- **A new CLIP layout with tabs:** Trim · Shape · Sound · Speed · Shots (Captions and Join come later). A dot marks a tab that's in use; a tab that can't do anything for this file or format is greyed (no Shape for an MP3, no Sound for a GIF). SHOTS works as before, in its own tab.
- **The line above Save says what will be saved:** the format, the picture size, whether it's copied (**FAST CUT** / **NO RE-ENCODE**) or **RE-ENCODE**d, and about how big it will be.
- **Save as MP3 · MP4 · GIF.**
- **Length presets:** 5 · 10 · 15 · 20 · 25 · 30 · 60 s under In / Out. Click: Out = In + that length. Shift-click: In = Out − that length. Keys 1–7 do the same while CLIP is the active window (Shift for In). A preset longer than the file is greyed. The one used last is underlined and remembered after a restart. Nothing is re-encoded.
- **Shape:** Original, 16:9, 9:16 (Shorts / TikTok), 1:1, 4:5. A box on the picture shows what's kept: drag it to move it, drag a corner or an edge to zoom in (it keeps the shape), or use Center / Left / Right. One box for the whole clip. By default the clip keeps the filmed pixels (9:16 from 1080p = 608×1080); **upscaled** (1080×1920, 1080×1080, 1080×1350, 1920×1080) is an option. Shape re-encodes, so Fast cut switches off (with a note) and comes back when Shape is back on Original.
- **Sound:** **Even out the volume** measures the clip first and brings it to −14 LUFS with peaks under −1 dB (FFmpeg loudnorm, two passes); it shows how loud the clip is now. A **Volume** control from −12 to +12 dB (after evening out). **Fade in / Fade out** moved here and now work for MP4 too. When only the sound changes in an MP4 with Fast cut, the picture is copied as it is and only the sound is re-encoded, so Fast cut keeps working. In an MP3, "Same quality as the file" switches off while Sound is used.
- **Speed:** 0.5× · 1× · 1.5× · 2× for MP3 and MP4 (and GIFs); voices keep their normal pitch. In / Out and the presets pick the part of the original; LENGTH, the Save button and the name show the new length; the preview plays at that speed. 0.5× shows each frame twice (no smooth slow motion). Speed re-encodes, so Fast cut switches off. **Clip again** on a sped-up clip brings its speed back.
- **GIF:** 480 px wide, 15 fps and looping by default (also 320 / 640 / Original, 10 / 24 fps, play once, Smaller colours). A quick 1-second test gives the size estimate; past 15 MB it warns (X's limit on the web), and past 5 MB it notes that phones take only 5 MB. Saved in Downloads\SlopAMP\gifs. The GIF settings are remembered.
- **Library → CLIPS has a GIFs chip.** A GIF opens in the computer's picture viewer (double-click or Open); Clip again, Rename, Show in folder and Delete work as for other clips.
- Anything drawn on the picture (the Shape box, its label, the speed badge) is white and black, so it reads the same in every skin.
- The tools start fresh for each new file; the length preset and the GIF settings are remembered.
- The CLIP window is bigger (860 × 770) so the tabs fit: a CLIP window saved smaller by an earlier version grows to that size once; a size you set afterwards stays. The saved-files list under it stays short (it scrolls).
- Unchanged: Fast cut, MP3 and MP4 clip saving without the new tools, SHOTS, Fix for X.
- Tests: `tests/clip-294.js`.

## 2.9.3 — released Nov 8, 2026

- **Closing a tab can move its items to another tab.** Closing a tab that has items (its right-click **Close tab**, or Ctrl+W) now asks, in the same style as the Load playlist box: **Move them to the end of** [another tab ▾], with **Cancel**, **Close, drop the list** and **Move to "…" & close**.
  - Move is selected, so pressing Enter never drops the list. The list offers your other playlist tabs with their counts (never YT / X History) and starts on the tab you last moved items to, else the one next to it.
  - All the items go to the end of that tab, in their order (like Load's "Add to end"), and that tab comes up. An item that's playing moves along and keeps playing.
  - The note afterwards has **Undo**, which puts the tab back where it was, with its items.
  - An empty tab still closes without asking. Files, downloads and saved playlists are never touched either way.
  - The last playlist tab can't close (it empties and becomes Main, as before): its box, **Clear tab**, offers **Save to Playlists & clear** (QUICK SAVE first), **Just clear it** or **Cancel**.
- **Drag the playlist tabs to reorder them.** Press a tab and move it left or right: a green bar shows where it lands. YT and X History stay first (they don't drag, and a tab dropped further left lands right after them). Near the strip's edge it scrolls. Esc, or letting go away from the strip, cancels. A click still selects and a double-click still renames; right-click → Move left / right / to front / to end stay.
- **Empty playlists open.** An empty saved playlist (SAVE ALL / QUICK SAVE write one for an emptied tab) opens as an empty tab named after it, with no error: from **LOAD** (it used to say "That playlist is empty or has nothing SlopAMP can play" and open nothing) and from Library → PLAYLISTS (Open in new tab, double-click, Classic or Preview view). LOAD of a playlist that's already open as a tab brings that tab up. A playlist that has lines but nothing SlopAMP can play still says so.
- **SAVE saves an empty tab too**, like QUICK SAVE and SAVE ALL (since 2.9.2): the usual file dialog, then an empty playlist SlopAMP can open again (it used to do nothing on an empty tab). The same for the tab's right-click **Save as playlist file…**. SAVE now writes the file in one go (a temporary file, then renamed), like QUICK SAVE.
- **SAVE and QUICK SAVE remember the file they saved to.** That tab is linked to the file, like a playlist opened from the Library: LOAD or Library → PLAYLISTS → Open of that file brings the tab up instead of opening a copy, and renaming the playlist in the Library renames the tab. Saved with SAVE under a different name, the tab takes the file's name (the note says so); QUICK SAVE keeps saving under the tab's name, with no window, and never renames the tab. Only one tab is linked to a file: another tab linked to it lets go of the link (it keeps its name and items). The link is kept across restarts. SAVE ALL doesn't link.
- A linked tab's tooltip shows its file, and its right-click menu has **Open file location** (greyed when the tab isn't linked; if the file was moved or deleted, it says so).
- **Saves that fail say why in plain words** (the folder doesn't exist any more, not allowed to save there, the disk is full, the file is open in another program, a folder has that name…) instead of a system error, for SAVE, QUICK SAVE, SAVE ALL and the Clear tab box. A failed or cancelled save leaves the tab, its items and its link as they were, and leaves no half-written file.
- The Library's **Open in new tab** (and double-click) brings up a tab that already has that playlist open instead of opening a second copy.
- The **Clear tab** box (the last playlist tab) has **Save as…** next to Save to Playlists & clear: pick where to save it, then the tab is cleared. Cancelling the window or a failed save leaves the tab as it was. A cleared tab is no longer linked to a file.
- **"?" has Check for updates again**: an Updates row with the status and the button, as before 2.9.2. It's still in Settings → Updates too (with "When a new version is out"), and both show the same.
- Tests: `tests/tabs-293.js`, `tests/empty-playlist-about-293.js`, `tests/save-link-293.js`.

## 2.9.2 — released Nov 8, 2026

- **Settings window**: every setting in one place, in its own window that opens next to the player (like CLIP) and remembers where you put it. Open it with **⚙** in the title bar, **Ctrl+,**, the tray menu's **Settings…**, **"?" → ⚙ Settings…** or the new **⚙** at the left of the playlist's bottom bar. **Esc** or **Done** closes it.
  - Sections: General, Playback, Downloads, YouTube & X, History, Look, Keys & Windows, Updates, About. **Search settings…** at the top finds a setting in any section.
  - Changes apply and save as you make them. The old spots still work as shortcuts (the History tabs' ⚙ menu, the Layout menu, the clock, the EQ's ON button…) and the window always shows the current values.
  - "?" is now just About, with a **⚙ Settings…** button. Everything that was under "?" moved to Settings.
- **New settings** (the defaults match what SlopAMP did before):
  - General → **Open where you left off**: the last item at the same spot (the default), the last item from the start, or the top of the playlist.
  - General → **Ask before closing while something downloads** (on): ✕ (or the tray's Quit) asks first while a download runs; **Close anyway** stops it.
  - Playback → **Skip countdown** on the X / YouTube choice boxes: 10 seconds (the default), 5, 15, 30, or **Off (wait for me)**.
  - Downloads → **MP3 quality**: Best (VBR, about 245 kb/s, the default), 320, 192 or 128 kb/s. The size limit's size check uses it too.
  - Downloads → **Warn me at** 90% (the default), 80% or never: with a size limit on, a note when a download will take the downloads folder past that much of the limit.
  - YouTube & X → **Streaming quality** for X posts played without downloading: up to 720p (the default), 480p or 1080p.
- **SAVE ALL also saves empty tabs**, so emptying a tab and saving empties its file in Playlists (before, an emptied tab's old file stayed, with its old items). **QUICK SAVE** on an empty tab does the same.
- The playlist's **MANAGE LIBRARY** button is now **LIBRARY**.
- Restarting SlopAMP without playing anything keeps the last item (it used to be forgotten after the second restart).
- About: "Not affiliated with or endorsed by Winamp, VideoLAN, YouTube/Google, or X."
- Tests: `tests/settings-292.js`; `tests/size-limit-favorites.js` and `tests/x-streaming.js` now use the Settings window.

## 2.9.1 — released Nov 8, 2026

- **Downloads folder size limit** ("?" → Downloads folder; Settings → Downloads from 2.9.2): **Off** (the default), 1, 5, 10, 25, 50 or 100 GB, or **Custom…**, with a bar of what's in SlopAMP's folders (videos, MP3s and clips count) that turns amber past 90%. With a limit on, the Library shows the bar next to the file count too.
  - With a limit on, SlopAMP checks how big a download will be before it starts (yt-dlp, about 2 seconds; from the length and quality when YouTube or X doesn't say). A download that fits just goes.
  - If it would pass the limit, nothing downloads until you answer a box. The box lists exactly which downloads would go to the Recycle Bin: the oldest first, never one that's in a playlist (any tab or saved playlist; YT History and X History don't count, nor their synced copies in Playlists) or a ★ favorite, and never clips, shots, skins or saved playlists. **Cancel download** is selected by default, so pressing Enter never deletes. **Choose files…** opens the Library oldest-first with those files ticked. A note says files go to the Recycle Bin and can be restored. **Why are these kept?** lists every kept file and what keeps it (which tab, which saved playlist, or ★).
  - When even that wouldn't make enough room, a second box says so and offers **Open Library**, **Cancel download** or **Download anyway**.
  - DOWNLOAD ALL asks for each item that would go over, with **Do the same for the rest of this download**; the result says how many were skipped.
  - **Make room…** runs the same cleanup whenever you like: free 1, 2, 5 or 10 GB, everything it can, or (when you're over) just enough to get back under the limit.
  - Nothing is ever deleted without the box. If a download turns out bigger than expected, SlopAMP only tells you that you're over the limit.
- **Favorites in the Library**: a ☆ before every title (a ★ on Preview tiles); click it, press **F**, or right-click → **★ Add to Favorites** (also on playlist items that have a file). **★ Favorites** next to the search shows only favorites, in any section. Favorites are never removed to make room; deleting one by hand still works, after a warning. A favorite stays a favorite when the file is renamed or a YouTube / X video is downloaded again.
- Downloads that are in a playlist say so in the Library ("▶ in Road Trip"; the tooltip names every tab and saved playlist that holds it), so you can see what the size limit keeps.
- Fix (bug #7): the Library's search box (and the skin picker's) was unreadable in Pocket LCD (dark green on dark green). Search boxes now use each skin's own field colours.
- Tests: `tests/size-limit-favorites.js` (the stand-in yt-dlp now also answers sizes and writes files).

## 2.9.0 — released Nov 5, 2026

Bug fixes only.

- Fix (bug #5): the History playlist tabs always read **YT** and **X**, selected or not; they used to say "YT History" / "X History" while selected. The selected one still shows its count. Tooltips, the ⚙ settings heading, the Layout menu, messages and the synced playlist file names haven't changed.
- Fix (bug #6): an X post that plays in SlopAMP now goes into **X History**, whether it streams or plays from a downloaded copy, the same way YouTube History works. (2.8 kept streamed posts out on purpose; the captain reversed that.)
  - It's added once it really starts playing. A post that couldn't play, Cancel, Skip and the Ask-me sheet on its own add nothing.
  - A post has one entry whichever way it played: it keeps the post's link and any downloaded file, and the ⚙ "When a post plays or downloads again" setting decides what a replay does (move up by default). Played from X History itself, only its time changes.
  - Finished X downloads are still added too. X History's ⚙ settings and tips now say "plays and downloads".
- Tests: `tests/history-29.js` (both fixes); `tests/x-streaming.js` and `tests/library-preview.js` updated for them.

## 2.8.0 — released Nov 5, 2026

- **X videos play inside SlopAMP** without downloading first, from X History, a playlist or a pasted x.com link. They play in SlopAMP's own player with the same controls as a file: seek, pause, next / previous, speed, fullscreen, EQ and the visualizer.
  - SlopAMP's yt-dlp asks X for the post's video link only (nothing is saved), the best MP4 up to 720p. The video goes through SlopAMP's own local server, so seeking and the EQ work.
  - While the link is fetched (usually 2–4 seconds) the video window says **Getting the video from X…**, with **Cancel**.
  - The source light reads **X**, and a **𝕏 streaming · 720p** tag shows in the corner for 3 seconds.
  - Links are kept for the session, so playing a post again or going back is instant. While one item plays, SlopAMP fetches the next X item's link, so a run of X posts doesn't wait each time.
  - If X refuses a link (or it runs out mid-video), SlopAMP asks once more and carries on from the same spot. If that fails too, **Couldn't play this X post** says why (deleted or private, sign-in only / sensitive, no video, X limiting requests, no connection) and offers **▶ X's player**, **⇩ Download**, **Play on X** and **Skip** (with the usual countdown). A clear answer from X (deleted, sign-in only, no video) isn't asked twice.
  - **▶ X's player** opens the new **X PLAYER** window with X's own post card (dark, no tracking, no sign-in). It has X's own controls; SlopAMP's EQ, visualizer and transport don't reach it.
  - GIF posts loop. A post with several videos plays the first one, or the one its link names (".../video/2").
  - A post you've downloaded still plays its file. Streamed posts don't go into X History (it stays for downloads).
- **"?" → X posts**: **Play right away** (the default) or **Ask me**. Ask me brings back the choice before an X post plays, now with **▶ Play here** next to Play on X / ⇩ Download / Skip.
- The 2.8 tests are in `tests/x-streaming.js` (with a stand-in yt-dlp, `tests/fake-ytdlp.js`).

## 2.7.1 — released Nov 4, 2026

- Fix: double-clicking a skin in Library → SKINS (a row in Classic or a tile in Preview) now puts it on, the same as Apply. The first click redrew the list, so the double-click was lost.
- Playlist tab menu: **Move to front** and **Move to end**, next to Move left / Move right. They're greyed when the tab is already first or last; History tabs stay at the front.

## 2.7.0 — released Nov 4, 2026

- **Library → Preview view**: a **☰ Classic | ▦ Preview** switch next to the search box shows a section as pictures instead of the list. Classic is the default, a one-time "New: Preview view" tip points at the switch, and each section remembers its own choice.
  - **VIDEO**: a frame from about 10% in, the length and the X ✓ tag. Rest the mouse on a tile and move across it to look through the video (10 frames, made on the first hover).
  - **MP3**: the song's cover art, or its waveform in the skin's colour when it has none.
  - **PLAYLISTS**: the first four items as a 2×2 mosaic (YT / X for links with no downloaded copy).
  - **CLIPS**: the clip's picture or waveform, with an amber bar showing which part of the original it is (In → Out).
  - **SKINS**: a little player in each skin's colours, ✓ ON on the one you have on; Apply / Edit / ⋯ on hover.
  - **ALL**: a mix, with a label on every tile.
  - Clicking, ticking (the box in a tile's corner), Ctrl / Shift click, double-click, right-click, Del and F2 work as in the list.
  - The pictures are made on your PC with SlopAMP's FFmpeg (nothing is fetched from YouTube or X) and kept in SlopAMP's data folder, keyed by the file, its size and its date. Only tiles on screen ask for one, two at a time; a 1,000-file Library opens in about a second, and pictures of files that are gone or changed are cleaned up. Classic view never makes pictures.
- New **MP3 downloads** get the video's thumbnail as their cover art (also shown by other players).
- **Compact History tabs**: YT History and X History show just the clock and **YT** / **X** when you're not looking at them (the full name and count are in the tooltip), and their full name when selected.
- Readable tab names and counts: the other playlist tabs' names and counts were faint in Chrome and Pocket LCD; they're now at least 4.5:1 (names) and 3:1 (counts) in all 10 skins.
- The website is no longer in this repository (slopamp.com is kept separately). The 2.7.0 tests are in `tests/`.

## 2.6.0 — released Nov 4, 2026

- **Rename** (right-click → **Rename…**, or **F2**) for playlist items (every tab, also YT History and X History) and in the Library for videos, MP3s and saved playlists (clips get the same box). A song, video, YouTube video or X post has one name everywhere it shows: every tab, YT / X History, the Library, and the same item added again later.
  - From the playlist only the name SlopAMP shows changes, unless you tick **Also rename the file on disk** (off the first time; SlopAMP remembers your last choice). For a YouTube / X item with a downloaded copy it's **Also rename the downloaded copy**; the copy keeps its " [id]" tag, so SlopAMP still knows which video it is.
  - A link with no file only gets a new display name. A renamed video keeps your name when SlopAMP refreshes titles, and **↺ Use YouTube's title** (or the post's title, or the file's own name) puts the original back.
  - From the Library, Rename always renames the file (keeping a download's [id] tag); a saved playlist's open tab is renamed with it.
  - When a file is renamed, every tab, the Library, CLIP's "Clip again", the X ✓ tag, "resume where you left off" and the saved playlists in Downloads\SlopAMP\Playlists follow it (playlist files saved elsewhere aren't changed). A file that's playing keeps playing from the same second.
  - Clear errors (a name that's taken, characters Windows doesn't allow, names like CON, over 150 characters); nothing is ever overwritten. **Undo** on the "Renamed" message for 8 seconds puts the name and the file name back.
- Fix (bug #4): in the Library a search carried over to the other sections, so CLIPS "jo" → SKINS showed an empty built-in list with no message. Each section (ALL, VIDEO, MP3, PLAYLISTS, CLIPS, SKINS) now keeps its own search until SlopAMP closes, and a small dot marks the other sections that have one. A section that comes up empty says why, e.g. "No clips match "jo"." with **✕ Clear search** and how many there are in all (CLIPS' MP3 / MP4 filter also offers **All clips**; SKINS says which list has no match). Esc, ✕ and Clear search clear only the section you're on. VIDEO and MP3 with nothing in them say how to get some.

## 2.5.2 — released Oct 31, 2026

- **Import skin** in the SKINS picker (idea #24): a tile next to **+ New skin** in MINE. Pick a `.css` skin and it's copied into `Downloads\SlopAMP\skins` with the same checks as the Skin editor's Import… (a file that isn't a skin or is too big says so and adds nothing). The SKINS panel opens again with the new skin in MINE, outlined for a moment; click it to put it on. Library → SKINS updates too.
- **Importing skins** (the picker, the Skin editor and Library → SKINS all use the same rules now): a skin whose name you already have comes in as **"Sunset Gold 2"** (then 3, 4 …) instead of a second "Sunset Gold"; the same skin again (the same file, also with other line endings, or one you exported) isn't copied: **"You already have this skin."**, and that skin is outlined in MINE. Several files at once say what happened to each kind ("Imported "A"; you already have "B"; 1 file wasn’t a skin.").
- A skin made by hand (no preview colours in its header) now shows its own colours on its card in the picker and the Library instead of Classic green; on import they're saved in its header. Skins imported earlier get them too.
- SKINS picker: the ✓ for the skin you have on now sits on the corner of its preview, so names get the card's full width ("SlopAMP Classic" fits); a name that is still too long ends in "…" inside its card instead of running to the edge (the full name is in the tooltip).
- Share playlist's "to" line and the Fix for X rows wrap between words too (they could split a word like the menu notes did).
- Fix: the DOWNLOAD ALL menu's note broke words in the middle ("one a t a time") (bug #3). "Downloads run one at a time." now has its own line, and menu notes never split a word any more: they wrap between words, and only something too long for a whole line (a folder path) is broken. This also fixes the same wrapping in the other menu notes (subtitles, downloads, live streams, keys).

## 2.5.1 — released Oct 30, 2026 (includes 2.5.0)

- Fix (found in the 2.5.0 smoke test): the X ✓ / not for X tag could stay wrong when a video was downloaded again under the same file name (X-ready, deleted, then Best quality): SlopAMP remembered what the old file was. Every file is now read again when its size or date changes, and the tags in the playlist, History and Library are re-checked when a download finishes, after a delete and when you come back to SlopAMP (also after a file is replaced in Explorer).

## 2.5.0 — never released on its own (folded into 2.5.1, released Oct 30, 2026)

- **X-ready MP4s** (idea #22): videos SlopAMP downloads now post to X. **X-ready** is the default: H.264 video + AAC sound, the best H.264 up to 1080p (720p / 480p work the same way). A video that has no H.264 falls back to its best format and is labelled "not for X". **Best quality** (4K / 1440p, often VP9 / AV1) is still in the DOWNLOAD menu, and **"?" → Video downloads** picks which one DOWNLOAD's ✓ item, DOWNLOAD ALL and EDIT's download use. Before, "Best quality" was the top choice and often saved VP9 / AV1 with Opus sound, which X refuses ("Incompatible video codecs").
- Every finished video download is checked for X. An H.264 picture with Opus sound gets AAC sound by itself in a few seconds (the picture is copied, nothing is re-encoded).
- **X ✓ / not for X** tags on video files in the playlist and the Library; hover for the reason (e.g. "VP9 + Opus").
- **𝕏 Fix for X…** (right-click a video in the playlist or the Library, several at once too): shows the file now and for X (codec, size, fps, about how big) and saves **"Title (X).mp4" next to the original, which is kept**. H.264 + AAC 160 kbps, 8-bit 4:2:0, fitted to 1920×1200 (or 1200×1900 upright), at most 60 fps, +faststart, with the same encoders as CLIP's Exact cut (NVIDIA / AMD / Intel, else OpenH264; OpenH264 if the hardware one fails). A video that's already H.264 within X's limits keeps its picture (copied) and only gets new sound. Progress with Cancel at the bottom; never over another file (" (X) (2).mp4"); clear errors; an X-ready file says "nothing to do".
- Over X's limits for free accounts (2:20 or 512 MB) Fix for X warns and offers **✂ Open in CLIP** to trim it first (X Premium allows up to 4 h on web / iOS and 16 GB).
- **CLIP**: an MP4 clip shows X ✓ (Exact cut makes H.264 + AAC) or "not for X" (bigger than 1920×1200, or a fast cut of a file that isn't X-ready), and warns when the clip is longer than 2:20.

## 2.4.0 — released Oct 29, 2026

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
