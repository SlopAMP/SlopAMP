#!/usr/bin/env python3
"""README.txt for the Linux packages (3.2.0): docs/README-users.txt in Linux words, with the Windows-only parts
(first launch, tray, "Make SlopAMP open playlists", the portable exe) replaced and a LINUX section added.

usage: make_readme_linux.py <README-users.txt> <out README.txt>
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

section('FIRST LAUNCH', '''  The .deb: install it with your software app (double-click it) or with
  "sudo apt install ./SlopAMP-X.Y.Z-amd64.deb"; SlopAMP is then in your apps.
  The AppImage: make it executable (right-click -> Properties -> "Allow
  executing file as program", or "chmod +x") and double-click it. It
  needs no installing. On Ubuntu 23.10 and later it runs without
  Chromium's sandbox (the system blocks it for AppImages; the .deb keeps
  it on): "?" shows which.''')

section('TRAY AND MEDIA KEYS ("?" or the Layout menu)', '''  * Minimize to the tray (off at first): "-" hides SlopAMP in the system
    tray instead. Music and YouTube keep playing. The icon's menu brings
    every window back where it was and has Previous / Play-Pause / Next /
    Stop / Settings / Quit. "x" still quits. It needs a tray on your desktop:
    KDE, Cinnamon, XFCE and Ubuntu's GNOME have one (other GNOME desktops
    with the AppIndicator extension); without one "-" minimizes as usual.
  * Use media keys (on at first): your keyboard's play / next / previous /
    stop keys control SlopAMP even in the background (the desktop hands them
    to SlopAMP, which also shows in its media controls). Turn it off to leave
    them to another player; that's complete after restarting SlopAMP.''')

swap('  * Drag files or folders onto any SlopAMP window (or onto SlopAMP.exe).',
     '  * Drag files or folders onto any SlopAMP window.')
swap('''    (the same file again just switches to its tab). To make double-click
    use SlopAMP: "?" -> Make SlopAMP open playlists..., then pick SlopAMP
    for .m3u8 / .m3u in Windows' Default apps (or right-click a playlist ->
    Open with -> Choose another app -> SlopAMP -> Always use this app).''',
     '''    (the same file again just switches to its tab). The .deb lists SlopAMP
    under Open With for playlists, songs and videos; to make double-click
    use it, right-click a file -> Open With... -> SlopAMP and set it as the
    default for that kind of file.''')
swap('''  * The portable exe can't update itself: it tells you and opens the
    download page.''',
     '''  * The AppImage updates itself the same way: it puts the new AppImage
    where it is (a name with the version in it, like SlopAMP-3.2.0-x86_64
    .AppImage, gets the new version's name; a name of your own is kept) and
    reopens. It needs to be allowed to write in its folder.
  * The .deb tells you about a new version and opens the download page:
    install the new .deb over the old one (your playlists stay).''')

# Linux words everywhere else
t = re.sub(r'Downloads\\[^\n]*', lambda m: m.group(0).replace('\\', '/'), t)
t = t.replace('Recycle Bin', 'Trash').replace('Show in Explorer', 'Show in folder').replace('open it in Explorer', 'open it in your file manager')

linux = '''LINUX
  * Your playlists and settings are in ~/.config/SlopAMP (the log is
    slopamp.log there); downloads in ~/Downloads/SlopAMP. An AppImage with
    a "SlopAMP Data" folder next to it keeps them in that folder instead.
  * SlopAMP runs on X11 (on a Wayland desktop through XWayland), because
    its windows snap, dock and move together and Wayland doesn't let an app
    place its own windows.
  * Formats that need converting use your graphics card: NVENC (NVIDIA),
    VA-API (AMD, Intel; needs the system's VA-API driver and libva 2.21 or
    later) or Vulkan Video (AMD and Intel with Mesa, NVIDIA), and OpenH264
    (no graphics card needed) otherwise. "?" shows which one.
  * Uninstall the .deb with your software app or "sudo apt remove slopamp";
    delete the AppImage file to remove that one. Your playlists, settings
    and downloads stay.

'''
swap('GOOD TO KNOW\n', linux + 'GOOD TO KNOW\n')
open(out, 'w', encoding='utf-8', newline='\n').write(t)
print('README (Linux) ok')
