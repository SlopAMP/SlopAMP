SLOPAMP - retro media player
============================

Plays your video and music files (MP4, MKV, AVI, MOV, WMV, WebM, MP3, FLAC,
WAV, OGG, M4A, WMA and more), plus YouTube videos through YouTube's
official embedded player. YouTube videos stream unless you choose to
download them.
X (Twitter) links are not supported.

FIRST LAUNCH
  Windows may show "Windows protected your PC" because SlopAMP isn't
  code-signed. Click "More info" -> "Run anyway". This only happens once.

ADDING THINGS
  * Drag files or folders onto the window (or onto SlopAMP.exe).
  * Paste a YouTube link anywhere with Ctrl+V, or use +URL.
  * Double-click an item to play it. Drag items to reorder them. Del removes them.
  * Your playlist is saved automatically.
  * SAVE / LOAD (bottom bar, or Ctrl+S / Ctrl+L) write and open .m3u8 playlist
    files. Loading asks whether to replace your list or add to the end.

KEYS
  Space       play / pause          Left/Right   seek 5 s (Shift = 30 s)
  Z X C V B   prev/play/pause/stop/next    Ctrl+Up/Down  volume
  F or F11    fullscreen (Esc exits) - or the FULLSCREEN button
  M           mini player              E             equalizer
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
  * DOWNLOAD ALL downloads the YouTube items in the tab you're looking at.

VISUALIZER
  * Music files show the BUTTERCHURN visualizer (1,731 presets). It changes
    preset every 30 seconds; use the arrows or PRESETS in its top-right
    corner to pick one (PRESETS has a search box). The PRESETS menu also turns auto-change, the song
    title flash, the track name (top corner) and the preset name on/off.
  * The visualizer has its own title bar: "-" minimizes it, "x" closes it;
    the VIS button at the top brings it back.
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
  * The 10-band equalizer opens above the video when SlopAMP starts.
    Click EQ in the top deck (or press E) to show/hide it. "-" in its title bar minimizes it to a thin strip
    (it keeps working); "x" closes it.
  * PRESETS: Flat, Rock, Pop, Bass Boost, Treble Boost, Vocal, Classical,
    Dance, Headphones, Laptop speakers. Drag or mouse-wheel any slider;
    double-click a slider to reset it to 0. ON turns the EQ on/off; RESET = flat.
  * Works on local files and downloaded copies. YouTube streams play inside
    YouTube's own player, so the EQ can't reach them.

DOWNLOADING YOUTUBE VIDEOS
  * Click DOWNLOAD (top deck) to save the YouTube video you're watching,
    or right-click any YouTube item in the playlist -> Download...
  * Pick Best / 1080p / 720p / 480p video (MP4) or Audio only (MP3).
  * Files go to Downloads\SlopAMP\Video and Downloads\SlopAMP\Audio
    ("Change folders..." in the download menu to pick others).
  * When it's done the item shows SAVED (or MP3) and plays from your copy
    from then on - even offline. If you're watching it when the download
    finishes, playback isn't interrupted.
  * Right-click -> Delete local copy moves the file to the Recycle Bin;
    the item stays in the playlist and streams from YouTube again.
  * Only download videos you have the right to save. YouTube's terms
    restrict downloading.
  * DOWNLOAD ALL: the ⇩ALL button at the bottom downloads every YouTube item
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

GOOD TO KNOW
  * Playlist tags: YT = YouTube, YTM = YouTube Music, YT LIVE = a stream
    that's live right now (download it after it ends), SAVED / MP3 = plays
    from your downloaded copy, WEB ONLY = owner blocks playback in other apps.
  * Some YouTube videos block playback in other apps. SlopAMP shows
    "Open in browser", "Download" and "Skip" buttons for those.
  * Formats that browsers can't play natively (AVI, WMV, HEVC, AC3 audio...)
    are converted live by the bundled FFmpeg. Seeking in those takes a moment.

Licenses: see LICENSE.txt, THIRD_PARTY_NOTICES.txt and the "licenses" folder,
or click the "?" button in the player.
