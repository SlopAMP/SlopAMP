SLOPAMP - retro media player
============================

Plays your video and music files (MP4, MKV, AVI, MOV, WMV, WebM, MP3, FLAC,
WAV, OGG, M4A, WMA and more), plus YouTube videos through YouTube's
official embedded player. YouTube videos stream unless you choose to
download them. X (Twitter) posts with video can be added too: they play
after you download them (X videos can't stream inside SlopAMP).

FIRST LAUNCH
  Windows may show "Windows protected your PC" because SlopAMP isn't
  code-signed. Click "More info" -> "Run anyway". This only happens once.

WINDOWS
  * SlopAMP has four windows: the player, the equalizer, the video /
    visualizer and the playlist. They start stacked together under the
    player. Drag any window by its title bar to move it; it snaps to screen
    edges and to the other windows (edge to edge, never overlapping).
  * Moving the player moves every window snapped to it. Pull a window away
    to use it on its own, e.g. the visualizer on a second monitor or TV.
  * Resize the video and the playlist with the grip in their bottom-right
    corner (or their right / bottom edge). The player and equalizer can be
    made wider from their right edge.
  * "-" rolls a window up to its title bar (double-click the title bar does
    the same); "x" closes it. EQ / VIS / VID / PL on the player bring them
    back. Windows docked underneath move up and down to stay attached.
  * Right-click any title bar (or the button next to "?" on the player)
    for the Layout menu: Classic (stacked), Playlist beside player, Big
    visualizer, snapping on/off, Keep windows on top and Reset layout.
  * Reset layout (Ctrl+Alt+R) puts every window back, stacked in the middle
    of your main screen. Use it if a window ever ends up off screen
    (SlopAMP also does this by itself when a monitor is unplugged).
  * Window positions and sizes are remembered between launches.

SKINS
  * Click SKINS on the player (or Skins... in the Layout menu) to change how
    SlopAMP looks. Ten skins: SlopAMP Classic (green, the default), Red Alert,
    Ice Blue, Purple Haze, Amber, Chrome, Walnut Hi-Fi, Synthwave, Terminal
    and Pocket LCD. Click one and it changes right away. Drag the picker by
    its title to move it (it reopens there); x or Esc closes it.
  * Your skin is remembered. The lightning bolt and Reset layout only move
    the windows back; they never change your skin.
  * Make your own: "+ New skin" in the picker (or "Skin editor..." in the
    Layout menu) opens the Skin Editor on the skin you have on. Its colours
    come in families (LCD & accent, player body, buttons, menus, text,
    warnings, danger, selection): move a family with Hue / Saturation /
    Brightness or pick its main colour, or open "Each colour" to change one.
    Every window shows the change at once. Type a name and click Save as;
    the skin is saved in Downloads\SlopAMP\skins as a .css file and
    shows under "Mine" in the picker. Closing without saving puts your skin
    back. A warning appears when text gets hard to read.
  * Library -> SKINS lists your skins and the built-in ones: Apply, Edit,
    Rename, Export (a .css to share), Show in Explorer, Delete (Recycle Bin),
    Import (a .css someone shared) and Open skins folder. Built-in skins
    can't be changed or deleted. Deleting the skin you have on goes back
    to SlopAMP Classic.

ADDING THINGS
  * Drag files or folders onto any SlopAMP window (or onto SlopAMP.exe).
  * Paste a YouTube or X link anywhere with Ctrl+V, or use +URL. X links
    from x.com, twitter.com, fxtwitter, vxtwitter, fixupx and t.co work.
  * Double-click an item to play it. Drag items to reorder them. Del removes them.
  * Your playlist is saved automatically.
  * SAVE / LOAD (bottom bar, or Ctrl+S / Ctrl+L) write and open .m3u8 playlist
    files. Loading asks whether to replace your list or add to the end.

KEYS
  Space       play / pause          Left/Right   seek 5 s (Shift = 30 s)
  Z X C V B   prev/play/pause/stop/next    Ctrl+Up/Down  volume
  F or F11    fullscreen video (Esc exits) - or the FULLSCREEN button
  M           mini player              E             equalizer
  Ctrl+Alt+R  reset the window layout
  G / I / O   SLOP: grab a frame / clip starts here / clip ends here
  S / R       shuffle / repeat (off, all, one)
  [ / ]       slower / faster (1x, 1.5x, 2x, 3x)
  Media keys  Play/Pause, Next, Previous and Stop keys on your keyboard work
              even when SlopAMP is in the background
  Ctrl+O      open files   Ctrl+U  add link   Alt+Up/Down  move item
  Click the time display to switch between elapsed and remaining time.
  Click the small spectrum to cycle bars / oscilloscope / off.

PLAYLIST TABS
  * Keep several playlists as tabs above the list. "+" (or Ctrl+T) adds a
    tab; double-click a tab to rename it; right-click for Rename, Duplicate,
    Save as playlist file, Move left/right and Close. Ctrl+Tab switches tabs.
  * Music keeps playing from its own tab (marked with a green arrow) while
    you browse others; Next/Previous stay in that tab.
  * Drag items onto a tab to move them there (hold Ctrl to copy), or
    right-click -> Move to "...". LOAD can open a playlist file in a new tab.
  * DOWNLOAD ALL downloads the YouTube and X items in the tab you're looking at.

VISUALIZER
  * Music files show the BUTTERCHURN visualizer (1,731 presets). It changes
    preset every 30 seconds; use the arrows or PRESETS in its top-right
    corner to pick one (PRESETS has a search box). The PRESETS menu also turns auto-change, the song
    title flash, the track name (top corner) and the preset name on/off.
  * The visualizer has its own window: "-" rolls it up, "x" closes it;
    the VIS button on the player brings it back.
  * Favorites: click the star in the visualizer bar (or next to any preset
    in PRESETS) to mark favorites; they're listed first, and "Only use
    favorites" makes auto-change and N pick just from them.
  * Keys while the visualizer is showing: N random preset, P previous
    preset, K lock/unlock the current preset, H add/remove favorite.
  * Click BARS to switch to the green spectrum bars instead (remembered).
    The controls fade away after a few seconds; move the mouse to see them.
  * Needs 3D graphics (WebGL); on PCs without it SlopAMP uses BARS.
    YouTube streams can't drive the visualizer; downloaded MP3s can.

RESUME WHERE YOU LEFT OFF
  * Anything 5 minutes or longer remembers where you stopped. Play it again
    (even after closing SlopAMP) and it continues from there. Click
    "Start over" in the little bar to go back to the beginning.

SPEED AND SUBTITLES
  * The 1x button in the video bar sets the speed: 1x, 1.5x, 2x or 3x.
    YouTube's player goes up to 2x; 3x works on local files and downloads.
  * CC turns on subtitles. For your own files SlopAMP finds subtitles
    inside the file (MKV/MP4 text subtitles) and .srt / .vtt / .ass files
    next to the video with the same name (e.g. Movie.mkv + Movie.en.srt),
    or use "Load subtitle file...". For YouTube it turns on YouTube's
    captions. Once on, subtitles stay on for the next videos.

EQUALIZER
  * The 10-band equalizer window opens under the player when SlopAMP starts.
    Click EQ on the player (or press E) to show/hide it. "-" in its title
    bar rolls it up to a thin strip (it keeps working); "x" closes it.
  * PRESETS: Flat, Rock, Pop, Bass Boost, Treble Boost, Vocal, Classical,
    Dance, Headphones, Laptop speakers. Drag or mouse-wheel any slider;
    double-click a slider to reset it to 0. ON turns the EQ on/off; RESET = flat.
  * Works on local files and downloaded copies. YouTube streams play inside
    YouTube's own player, so the EQ can't reach them.

YOUTUBE HISTORY
  * The first tab, YT History (clock icon), fills itself: every YouTube
    video you play is added, newest at the top, with when you watched it
    (now, 12m, 3h, yday, Mon, Oct 19). Downloaded copies of YouTube videos
    count too; your own files and X posts don't, and a video that couldn't
    play isn't added. Hover a row for the date and the video's length.
  * It's saved by itself, no pop-ups. It also keeps a synced copy in
    Downloads\SlopAMP\Playlists\YouTube History.m3u8 (it shows in
    Library -> Playlists).
  * Settings: the gear on the strip at the top of the tab, or right-click
    the tab. Record YouTube plays (on/off), Keep a synced copy in
    Playlists, Order (newest or oldest at the top), When a video plays
    again (move it up / leave it / add it again), Keep (last 50, 100, 250,
    500, a number of your own, or no limit), Save a copy as playlist
    file... (a normal playlist you can edit and combine), Clear history...
    and Restore default options. Keeping fewer videos asks before it
    removes older ones.
  * History keeps its own order: you can play, download and remove rows,
    but not add, move or sort them. Dragging rows to another tab copies
    them. SAVE ALL skips History (it has its synced copy); QUICK SAVE on
    History updates that copy now.
  * Turn recording off and clear History, and the tab hides. Layout ->
    YouTube History brings it back.

X HISTORY
  * The second tab, X History, keeps the X posts you've downloaded. A post
    is added when its download finishes (video or Audio only MP3); Play on
    X, Skip, or a download that failed or was canceled doesn't add it.
    Rows show when you downloaded (or last played) it.
  * Right-click a row -> Open in browser opens the post on X. The
    downloaded files stay linked, so it plays here too.
  * Same settings and rules as YT History (gear on the strip or right-click
    the tab): Record X downloads, a synced copy in
    Downloads\SlopAMP\Playlists\X History.m3u8, Order, When a post is
    downloaded again (move it up / leave it / add it again), Keep, Save a
    copy..., Clear history..., Restore default options.
  * Turn recording off and clear it, and the tab hides. Layout -> X History
    brings it back.

DOWNLOADING YOUTUBE AND X VIDEOS
  * Click DOWNLOAD (on the player) to save the YouTube video you're watching,
    or right-click any YouTube or X item in the playlist -> Download...
  * Pick Best / 1080p / 720p / 480p video (MP4) or Audio only (MP3).
  * Files go to Downloads\SlopAMP\Video and Downloads\SlopAMP\Audio
    ("Change folders..." in the download menu to pick others).
  * When it's done the item shows SAVED (or MP3) and plays from your copy
    from then on - even offline. If you're watching it when the download
    finishes, playback isn't interrupted.
  * Right-click -> Delete local copy moves the file to the Recycle Bin;
    the item stays in the playlist and streams from YouTube again.
  * Only download videos you have the right to save. YouTube's and X's terms
    restrict downloading.
  * X posts: SlopAMP can't stream X videos, so an X item doesn't play until
    it's downloaded. When the playlist reaches one that isn't saved yet, you
    get three choices: Play on X (opens the post in your browser), Download
    (pick the quality; it starts playing when the download finishes) or Skip.
    Skip counts down from 10 and moves on by itself at 0, so a playlist keeps
    going; any button stops the count, and it waits while you pick a
    download quality. YouTube videos that can't play here (blocked by their
    owner, or YouTube unreachable) get the same countdown. A post with
    several videos: add the link ending in /video/2 (and so on) for the
    others. Posts X only shows to signed-in accounts can't be downloaded.
  * DOWNLOAD ALL: the ⇩ALL button at the bottom downloads every YouTube and X item
    in the playlist (all MP3, or all video at one quality), one after
    another. Live streams and items already saved are skipped.
  * MANAGE LIBRARY (bottom bar, or "Manage library..." in the download menu)
    shows everything SlopAMP has downloaded plus your saved playlists, with
    size, date and total space used. Filter by Video / MP3 / Playlists,
    type in the search box to find things fast, sort by any column, tick
    items and "Delete selected" or "Delete all" (Recycle Bin). Double-click
    a playlist (or "Open in new tab") to open it. Files you deleted yourself
    show as MISSING; "Clean up missing" clears them. SlopAMP re-checks its
    downloads whenever you switch back to it.
  * QUICK SAVE (or Ctrl+Shift+S) saves the tab you're looking at straight
    to Downloads\SlopAMP\Playlists\<tab name>.m3u8 with no questions,
    replacing the older copy.
  * SAVE ALL (or Ctrl+Alt+S) does the same for every tab at once (empty tabs
    are skipped).
  * SAVE / LOAD use Downloads\SlopAMP\Playlists by default, so downloads and
    playlists all live in one place (Downloads\SlopAMP).
  * SlopAMP keeps its downloader (yt-dlp) up to date automatically.

SLOP (packs of a YouTube moment for slop.cc)
  * Click SLOP (next to FULLSCREEN) while a YouTube video plays. SLOP is its
    own window: move it, snap it, resize it, keep watching. It makes a pack
    in Downloads\SlopAMP\Slop\<date> <title> @<time>.
  * While you watch, in any SlopAMP window: G grabs the frame on screen,
    I and O set where the clip starts and ends (SLOP doesn't need to be open).
  * AUDIO: the song is downloaded once; the wave appears when it's here
    (Stop / Start control that download). The clip is the green part: drag
    its edges or the whole clip, drag on the wave for a new one, or type the
    seconds before / after the moment. A click on the wave jumps the player
    there. Ticks: Whole song (song.mp3) and a Second clip (audio-2.mp3,
    the dashed range). Long videos (over 20 min): only 3 minutes either
    side of the moment are downloaded, so no whole song.
  * LOOK: every frame comes from the video itself (up to 1080p, no player
    buttons). Give each one a name (Singer, Stage...) and a kind (person,
    look, prop, place): it goes into the file name, like slop.cc's reference
    bank. The lead is always ref-01. < 1 s / 1 s > and Re-grab change a
    frame. Burst x5 grabs 5 candidates across the clip: mark the best as
    Lead or Ref and Keep them (slop.cc prefers a few clear references).
    Motion reference: a silent 2-5 s motion.mp4 around the lead frame.
    If a frame can't be had from the video you can choose the video
    window's picture instead (smaller; slop.cc warns under 512 px).
  * PROMPT: pick Roast / Remake / Music video / Custom or write your own.
    "Suggested" is a scene line made from the title and description.
    Copy puts the prompt on the clipboard; Save writes prompt.txt (with a
    short rights note at the end). If YouTube has captions for the clip,
    they're saved as lyrics.txt.
  * Open in Slop.cc: opens the pack folder and slop.cc (a new video) in your
    browser and copies the prompt. On slop.cc attach the song or clip and
    the references, paste the prompt and confirm the rights there.
    Zip pack makes one .zip next to the folder (for sharing or backup).
  * Library -> SLOP lists every pack: search (titles, reference names,
    prompts, lyrics), filter, preview and play, rename, zip, show in
    Explorer, delete (Recycle Bin). Double-click a pack to keep working on it.
  * SlopAMP uploads nothing itself. Only use songs, faces, logos and images
    you have the rights or permission for.

UPDATES
  * SlopAMP checks GitHub once a day for a new version (open "?" to change
    this or to check right away). Choose "Notify me" (the default),
    "Install automatically" or "Off".
  * A bar under the player says when a new version is out. "What's new"
    shows the release notes first. The update is downloaded from SlopAMP's
    official GitHub release, its checksum is verified, and SlopAMP restarts
    with your playlists and settings kept. It never installs until you click.
  * In the "?" box the button follows the update: "Check for updates",
    then "Install update..." once one is found, and "Restart and install"
    when it's downloaded and verified.
  * The portable exe can't update itself: it tells you and opens the
    download page.

GOOD TO KNOW
  * Playlist tags: YT = YouTube, YTM = YouTube Music, X = an X post, YT LIVE = a stream
    that's live right now (download it after it ends), SAVED / MP3 = plays
    from your downloaded copy, WEB ONLY = owner blocks playback in other apps.
  * Some YouTube videos block playback in other apps. SlopAMP shows
    "Open in browser", "Download" and "Skip" buttons for those.
  * Formats that browsers can't play natively (AVI, WMV, HEVC, AC3 audio...)
    are converted live by the bundled FFmpeg. Seeking in those takes a moment.

Licenses: see LICENSE.txt, THIRD_PARTY_NOTICES.txt and the "licenses" folder,
or click the "?" button in the player.
