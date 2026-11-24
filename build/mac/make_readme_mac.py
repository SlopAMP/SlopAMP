#!/usr/bin/env python3
"""README.txt for the macOS .dmg: docs/README-users.txt in Mac words, with the Windows-only parts (first launch, tray,
"Make SlopAMP open playlists", the portable exe) replaced and a MAC section added. The Mac's make_readme_linux.py.

usage: make_readme_mac.py <README-users.txt> <out README.txt>
"""
import re, sys

src, out = sys.argv[1:3]
t = open(src, encoding='utf-8').read().replace('\r\n', '\n')

def section(title, body):
    """Replace the body of the section headed `title` (up to the next all-caps heading)."""
    global t
    m = re.search(rf'^{re.escape(title)}\n(.*?)(?=^[A-Z][A-Z0-9 /&\'"()?.-]*$)', t, re.S | re.M)
    assert m, title
    t = t[:m.start(1)] + body.rstrip('\n') + '\n\n' + t[m.end(1):]

def swap(old, new):
    global t
    assert old in t, old[:60]
    t = t.replace(old, new)

section('FIRST LAUNCH', '''  Open the .dmg and drag SlopAMP onto Applications. Pick the .dmg for your
  Mac: "arm64" for Apple silicon (M1 and later), "x64" for an Intel Mac.
  SlopAMP isn't signed with an Apple developer certificate yet, so the first
  time macOS refuses to open it. To open it anyway: try to open it once,
  then go to System Settings -> Privacy & Security, scroll down and click
  "Open Anyway" (older macOS: right-click SlopAMP -> Open -> Open). If macOS
  says SlopAMP "is damaged", run this once in Terminal:
  xattr -dr com.apple.quarantine /Applications/SlopAMP.app''')

section('TRAY AND MEDIA KEYS ("?" or the Layout menu)', '''  * Minimize to the menu bar (off at first): "-" hides SlopAMP in the menu
    bar (next to the clock) instead of the Dock. Music and YouTube keep
    playing. The icon's menu brings every window back where it was and has
    Previous / Play-Pause / Next / Stop / Settings / Quit; a click on SlopAMP
    in the Dock brings it back too. "x" still quits.
  * Use media keys (on at first): your keyboard's play / next / previous
    keys, headphone buttons and the menu bar's Now Playing controls work
    SlopAMP even in the background. Turn it off to leave them to another
    player; that's complete after restarting SlopAMP.''')

swap('  * Drag files or folders onto any SlopAMP window (or onto SlopAMP.exe).',
     '  * Drag files or folders onto any SlopAMP window (or onto SlopAMP in the\n    Dock).')
swap('''    (the same file again just switches to its tab). To make double-click
    use SlopAMP: "?" -> Make SlopAMP open playlists..., then pick SlopAMP
    for .m3u8 / .m3u in Windows' Default apps (or right-click a playlist ->
    Open with -> Choose another app -> SlopAMP -> Always use this app).''',
     '''    (the same file again just switches to its tab). SlopAMP is listed
    under Open With for playlists, songs and videos; to make double-click
    use it, select a file in the Finder, File -> Get Info -> Open with ->
    SlopAMP -> Change All.''')
swap('''  * The portable exe can't update itself: it tells you and opens the
    download page.''',
     '''  * On a Mac SlopAMP tells you about a new version and opens the download
    page: drag the new SlopAMP onto Applications, over the old one (your
    playlists stay).''')

# Mac words everywhere else
t = re.sub(r'Downloads\\[^\n]*', lambda m: m.group(0).replace('\\', '/'), t)
t = t.replace('Recycle Bin', 'Trash').replace('Show in Explorer', 'Show in Finder').replace('open it in Explorer', 'open it in the Finder')
t = re.sub(r'Ctrl\+(?!Tab)(\S+)(  +)', r'Cmd+\1\2 ', t)        # (a column of the KEYS table keeps its width)
t = re.sub(r'Ctrl\+(?!Tab)', 'Cmd+', t).replace('Cmd+Alt+', 'Cmd+Option+').replace('Ctrl / Shift', 'Cmd / Shift').replace('hold Ctrl to copy', 'hold Cmd to copy')
t = t.replace('Cmd+M / M  mini mode', 'Cmd+M / M   mini mode').replace('Alt+Up/Down', 'Option+Up/Down')

mac = '''MAC
  * Your playlists and settings are in ~/Library/Application Support/SlopAMP
    (the log is slopamp.log there); downloads in ~/Downloads/SlopAMP.
  * Cmd is the Mac's Ctrl in every shortcut here (Ctrl works too); Ctrl+Tab
    switches tabs. SlopAMP's windows are its own, like on Windows: they snap
    and dock to each other, and "-" puts them all in the Dock together.
  * Formats that need converting use the Mac's own video encoder
    (VideoToolbox), and OpenH264 otherwise. "?" shows which one.
  * To uninstall, drag SlopAMP from Applications to the Trash. Your
    playlists, settings and downloads stay.

'''
swap('GOOD TO KNOW\n', mac + 'GOOD TO KNOW\n')
open(out, 'w', encoding='utf-8', newline='\n').write(t)
print('README (macOS) ok')
