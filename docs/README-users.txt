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
    for the Layout menu: Classic (stacked), Classic (stacked, No EQ),
    Playlist beside player, Big visualizer, snapping on/off, Keep windows
    on top and Reset layout.
  * Classic (stacked, No EQ) is the classic stack without the equalizer
    window: player, video and playlist with no gap. The EQ keeps working
    (on/off, bands and preset stay as they are), it's just not on screen,
    and SlopAMP remembers it next time. EQ (or E) puts the equalizer back
    under the player and the layout becomes Classic (stacked) again;
    picking Classic (stacked) also shows it.
  * The lightning bolt on the player puts the windows back in Classic
    (stacked), docked under the player (and brings back a closed video or
    playlist). If Classic (stacked, No EQ) was the last layout you picked
    in the Layout menu, it gives you that instead, EQ still hidden. Hover
    it to see which one you'll get.
  * Reset layout (Ctrl+Alt+R) puts every window back, stacked in the middle
    of your main screen. Use it if a window ever ends up off screen
    (SlopAMP also does this by itself when a monitor is unplugged).
  * Window positions and sizes are remembered between launches.

MINI MODE
  * Layout -> Mini mode, Ctrl+M (or M, or the button next to "-" on the
    player) turns the player into one small bar that stays on top of other
    windows: previous / play / pause / stop / next, the title, the time,
    a volume slider and a button to go back.
  * Drag the bar anywhere; it comes back there next time. Double-click it
    (or its button on the right, or Ctrl+M again) for the full player, with
    every window back where it was. Right-click it for the Layout menu.
  * A video that's playing keeps its window open (where it is); the other
    windows hide until you leave mini mode. Fullscreen from mini mode goes
    back to the bar afterwards. The lightning bolt, Reset layout and picking
    a layout leave mini mode first. Quit in mini mode and SlopAMP starts in
    it next time.

TRAY AND MEDIA KEYS ("?" or the Layout menu)
  * Minimize to the tray (off at first): "-" (or the taskbar) hides
    SlopAMP next to the clock instead. Music and YouTube keep playing. Click
    the icon to bring every window back where it was; hover it for the song;
    right-click for Previous / Play-Pause / Next / Stop / Show / Quit. The
    icon is only there while SlopAMP is in the tray. "x" still quits.
  * Use media keys (on at first): your keyboard's play / next / previous /
    stop keys control SlopAMP even in the background. Turn it off to leave
    them to another player (Spotify, your browser); that's complete after
    restarting SlopAMP.

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
  * Library -> SKINS lists your skins and the built-in ones, each with its
    own buttons: Apply (ON on the skin you have on), Edit and Delete for
    yours; Apply and "Edit a copy" for the built-ins (they can't be changed
    or deleted, so Edit starts a skin of your own from one). "..." or
    right-click: Rename, Export (a .css to share), Show in Explorer.
    Double-click or Enter puts a skin on; Del deletes the selected ones of
    yours (Recycle Bin). Deleting the skin you have on goes back to SlopAMP
    Classic. Below the list: + New skin, Import (a .css someone shared),
    Open skins folder and Delete selected.

ADDING THINGS
  * Drag files or folders onto any SlopAMP window (or onto SlopAMP.exe).
  * Paste a YouTube or X link anywhere with Ctrl+V, or use +URL. X links
    from x.com, twitter.com, fxtwitter, vxtwitter, fixupx and t.co work.
  * Double-click an item to play it. Drag items to reorder them. Del removes them.
  * Your playlist is saved automatically.
  * SAVE / LOAD (bottom bar, or Ctrl+S / Ctrl+L) write and open .m3u8 playlist
    files. Loading asks whether to replace your list or add to the end.
  * Double-click a playlist file (.m3u8 / .m3u / .pls) or use Open with ->
    SlopAMP: it opens in a new tab named after the file and starts playing
    (the same file again just switches to its tab). To make double-click
    use SlopAMP: "?" -> Make SlopAMP open playlists..., then pick SlopAMP
    for .m3u8 / .m3u in Windows' Default apps (or right-click a playlist ->
    Open with -> Choose another app -> SlopAMP -> Always use this app).

SHARE A PLAYLIST
  * Right-click a playlist tab -> Share playlist (.zip)... (or Library ->
    PLAYLISTS -> right-click -> Share (.zip)...) makes one .zip with the
    playlist and its songs and videos, so a friend gets everything.
    YouTube / X links stay links; tick "Also include my downloaded copies"
    to put those files in too. It shows the size first and which files are
    missing; saved in Downloads\SlopAMP\Shared (Change... to pick another
    place). Cancel stops it and leaves nothing behind.
  * Inside: <name>.m3u8 and a <name> folder with the files, numbered in
    playlist order. Unzip it and open the .m3u8 in any player.
  * Got one? Drop the .zip on SlopAMP, LOAD it or Open with -> SlopAMP: it
    unpacks to Downloads\SlopAMP\Shared\<name> (never over anything) and
    opens as a new tab. Only songs, videos and playlists come out of it.

KEYS
  Space       play / pause          Left/Right   seek 5 s (Shift = 30 s)
  Z X C V B   prev/play/pause/stop/next    Ctrl+Up/Down  volume
  F or F11    fullscreen video (Esc exits) - or the FULLSCREEN button
  Ctrl+M / M  mini mode                E             equalizer
  Ctrl+Alt+R  reset the window layout
  G / I / O   in CLIP (while it's the active window): shot / In / Out
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
    Save as playlist file, Share playlist (.zip), Move left/right and Close.
    Ctrl+Tab switches tabs.
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

CLIP (CUT A PIECE OUT OF A SONG OR VIDEO)
  * EDIT on the player opens CLIP on the selected song or video (or the
    one playing): a video file opens as MP4, a song as MP3 (switch at the
    top of CLIP). Right-click EDIT for Clip MP3 / Clip video and Library ->
    CLIPS. (EDIT was the SLOP button; see SLOP below.)
  * Right-click a song or video in the playlist (also in YT History and
    X History) or in the Library -> Clip MP3... or Clip video... A YouTube
    or X item that isn't downloaded yet is downloaded first (MP3 or best
    video); CLIP opens when it's done. Layout -> CLIP opens it empty: Clip
    what's playing, Pick a file..., or drop a file on the window.
  * Set where the clip starts and ends: drag the green edges on the wave
    (or the clip itself), drag on the wave for a new range, type a time
    (1:26.4) or use - / + (0.1 s; Shift-click 1 s). Set In / Set Out use
    where the preview is. Zoom (- / + / Fit, or the mouse wheel on the
    wave) for long files. Videos show a preview and a strip of frames.
  * Play clip, Loop, and short previews around each edge (|< In, Out >|).
    The preview plays inside CLIP; SlopAMP's player pauses (no double
    audio). While the CLIP window is the active one: Space plays the clip,
    I / O set In / Out, Left / Right move the edge you touched last by
    0.1 s (Shift: 1 s), G takes a shot. Other windows don't use them.
  * Save as MP3: same quality as the file (an MP3, no re-encode, fast) or
    MP3 320 kbps (re-encoded; needed for Fade in 0.5 s / Fade out 2 s).
  * Save as MP4 (H.264 + AAC, same size as the video): Exact cut
    re-encodes so it starts on the frame you picked; Fast cut copies the
    video without re-encoding (H.264 .mp4 videos only) and may start up
    to a few seconds early. "Also save the sound as MP3" makes both.
  * MP3 clips go to Downloads\SlopAMP\mp3clips, MP4 clips to
    Downloads\SlopAMP\mp4clips, named "Title (0m26s-1m26s)". The original
    file is never changed; every clip is a new file. "Add to ... when it's
    saved" puts it in the playlist.
  * Library -> CLIPS lists every clip (All / MP3 clips / MP4 clips) with
    its length and what it was cut from: play, add to a playlist, Clip
    again... (reopens CLIP on the original with the same In / Out), rename,
    show in folder, delete (Recycle Bin). Files you put in those folders
    yourself show up too.
  * SHOTS (videos only, optional; one line until you use it): + Shot (or G
    while CLIP is the active window) saves the frame the preview shows, full
    size. Burst x5 grabs 5 frames across the clip: click the good ones and
    Keep. Pick a shot to give it a name and a kind (person, look, prop,
    place) or make it the Lead (always ref-01); < 1 s / Re-grab / 1 s > grab
    it again. Files: Downloads\SlopAMP\Shots\<video title>\ref-01 Name
    (kind).png ...
  * CLIP only trims: no joining pieces, volume, speed, crop or text.

YOUTUBE WINDOW
  * YOUTUBE (bottom right of the playlist, or Layout -> YOUTUBE) opens
    youtube.com in a SlopAMP window. SlopAMP's windows move to the left edge
    of the screen and YouTube fills the rest to their right. It's a normal
    SlopAMP window: it snaps, moves and resizes. On a small screen it stays
    at least 800 px wide and overlaps the player instead of squeezing it.
  * Closing it puts SlopAMP back where it was (unless you moved it). If you
    move or resize the YouTube window yourself, it opens where you left it
    next time and nothing else moves (Reset layout undoes that).
  * Add a video: drag the "drag to playlist" handle (or a video's thumbnail
    on the page) onto a playlist tab or row, or click + Add to "Main" (the
    arrow next to it picks the tab). Play in SlopAMP adds it and plays it.
  * Back / forward / reload / YouTube home are on its bar; type a YouTube
    link or words to search YouTube in the address box.
  * No double audio: starting a video on the page pauses SlopAMP, and while
    SlopAMP plays, a video that starts by itself on the page waits.
  * Only YouTube opens in it (and Google's sign-in pages); other links open
    in your normal browser. It keeps its own sign-in. If Google won't let
    you sign in there, gear -> Open this page in your normal browser
    (watching works signed out). Gear -> Clear YouTube data signs you out.
  * SlopAMP doesn't change YouTube's pages (no ad blocking) and nothing is
    downloaded from the page itself: use DOWNLOAD in SlopAMP.

DOWNLOADING YOUTUBE AND X VIDEOS
  * Click DOWNLOAD (on the player) to save the YouTube video you're watching,
    or right-click any YouTube or X item in the playlist -> Download...
  * Pick X-ready / 720p / 480p / Best quality video (MP4) or Audio only (MP3).
    X-ready (the default, ticked) saves H.264 video + AAC sound, the best up
    to 1080p, so the file posts to X; 720p and 480p do the same, smaller.
    Best quality takes the largest picture (4K / 1440p), usually VP9 or AV1,
    which X won't take. "?" -> Video downloads picks which one is ticked and
    what DOWNLOAD ALL uses.
  * After a video download SlopAMP checks it for X. H.264 with Opus sound
    gets AAC sound by itself (seconds). A video YouTube only has as VP9 /
    AV1 is labelled "not for X".

POSTING VIDEOS TO X
  * Video files show "X ✓" (posts to X as it is) or "not for X" in the
    playlist and the Library; hover the tag to see why.
  * Right-click a video (playlist or Library, several at once too) -> Fix
    for X... It shows what the file is now and what it'll be, then saves
    "<name> (X).mp4" next to the original, which is kept: H.264 + AAC, at
    most 1920x1200 (1200x1900 upright) and 60 fps. Progress shows at the
    bottom with x to cancel. Uses your graphics card's encoder when it can,
    like CLIP.
  * Free X accounts can post up to 2:20 and 512 MB (X Premium: 4 hours and
    16 GB on the web / iPhone). Longer or bigger: Fix for X warns and offers
    Open in CLIP to trim it first. CLIP shows X ✓ on MP4 clips and warns past
    2:20.
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

SLOP (removed in 2.3.1)
  * SLOP was hidden in 2.3.0 and removed in 2.3.1: CLIP trims songs and
    videos better, and its reference frames (burst, full-size grabs) are
    SHOTS in CLIP. Packs you made are still in Downloads\SlopAMP\Slop;
    SlopAMP never deletes that folder (open it in Explorer).

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
