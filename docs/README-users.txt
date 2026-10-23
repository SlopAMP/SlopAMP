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

ADDING THINGS
  * Drag files or folders onto any SlopAMP window (or onto SlopAMP.exe).
  * Paste a YouTube link anywhere with Ctrl+V, or use +URL.
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

DOWNLOADING YOUTUBE VIDEOS
  * Click DOWNLOAD (on the player) to save the YouTube video you're watching,
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
  * Playlist tags: YT = YouTube, YTM = YouTube Music, YT LIVE = a stream
    that's live right now (download it after it ends), SAVED / MP3 = plays
    from your downloaded copy, WEB ONLY = owner blocks playback in other apps.
  * Some YouTube videos block playback in other apps. SlopAMP shows
    "Open in browser", "Download" and "Skip" buttons for those.
  * Formats that browsers can't play natively (AVI, WMV, HEVC, AC3 audio...)
    are converted live by the bundled FFmpeg. Seeking in those takes a moment.

Licenses: see LICENSE.txt, THIRD_PARTY_NOTICES.txt and the "licenses" folder,
or click the "?" button in the player.
