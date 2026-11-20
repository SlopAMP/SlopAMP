#!/usr/bin/env python3
"""Fixes two bugs in Chromium's X11 drag and drop, in Electron 45.3.3's Linux binary (SlopAMP 3.2.0).

SlopAMP runs on X11 (XWayland on a Wayland desktop). A link dragged in from a native Wayland app such as Chrome
reaches it through GNOME's XWayland bridge and Chromium's X11 drag-and-drop code, which in Chromium 156
(Electron 45) has two bugs:

1. The crash. Chrome sends text/x-moz-url as UTF-8; Chromium's X11 side reads it as UTF-16, and when the byte
   count is odd ui::RefCountedMemoryToString16() fails a CHECK and the whole app dies (SIGTRAP in the main
   process). Fixed upstream on 2026-11-02 (Chromium dabcf3ee8b11 "x11: Reject incomplete UTF-16 selection
   payloads", Chromium 159+), in no Electron 45. Patched: an odd byte count gives a string of NULs (no URL)
   instead of the crash, as upstream rejects it.
2. Lost data ("the drop does nothing"). Each XdndPosition that comes while Chromium is still fetching the drag's
   data clears what it has fetched and starts another request (ui::XDragContext::OnXdndPositionMessage). GNOME
   sends a position for every pointer motion, so a drop often comes with no data at all. Patched: a position that
   comes during the fetch only moves the drop point; the fetch runs once and gets every type.

These are byte patches at fixed places, so the script only works on the exact Electron 45.3.3 linux-x64 binary
(by SHA256), checks every byte it replaces and checks the result's SHA256. For any other Electron it stops: drop
this step once Electron has both fixes (46+ has the first; check the second), or find the places again.
usage: patch-electron-linux.py ELECTRON_BINARY [--check]   (--check: exit 1 unless it is patched)
"""
import hashlib, os, shutil, struct, sys

UNPATCHED = '68515da4b2af884d5cacf8c734ae8bb9b87fb0c57463813e1d5fed1b31758989'   # electron, v45.3.3 linux-x64 zip
PATCHED = 'f8b970bffe2c1fdbde334fe6f17d94f17542ed574446cdec889dda652767d68c'
# (virtual address, old bytes, new bytes, what)
PATCHES = [
    (0xa471324, '75 3c', '75 2d',
     'RefCountedMemoryToString16: an odd byte count returns (NULs) instead of the CHECK'),
    (0xa47f10f,
     '49 89 f7 89 57 50 48 8b 47 40 48 3b 47 38 75 19 4c 89 ff 89 ce 4c 89 ca 48 83 c4 20 5b 41 5c 41 5e 41 5f 5d'
     ' e9 78 08 00 00',
     '49 89 f7'            # mov %rsi,%r15                 (as before)
     ' 89 57 50'           # mov %edx,0x50(%rdi)           suggested_action_ (as before)
     ' 80 7f 10 01'        # cmpb $1,0x10(%rdi)            waiting_to_handle_position_ ...
     ' 0f 84 33 01 00 00'  # je 0xa47f252                  ... then only update screen_point_ (below)
     ' 48 8b 47 40'        # mov 0x40(%rdi),%rax           unfetched_targets_ empty? (as before)
     ' 48 3b 47 38'        # cmp 0x38(%rdi),%rax
     ' 75 0f'              # jne 0xa47f138                 no: fetch them (as before)
     ' 4c 89 ff 89 ce 4c 89 ca'  # client->CompleteXdndPosition(source_window, screen_point) (as before, but
     ' e8 7a 08 00 00'     # call 0xa47f9b0                 a call instead of the tail jump, to make room)
     ' eb 77',             # jmp 0xa47f1af                 the function's own epilogue
     'XDragContext::OnXdndPositionMessage: while fetching, a position only updates the drop point'),
    (0xa47f252, 'cc cc cc cc cc cc cc cc cc cc cc cc',      # int3 padding after RequestNextTarget()
     '49 8b 01'            # mov (%r9),%rax
     ' 48 89 47 14'        # mov %rax,0x14(%rdi)           screen_point_ = screen_point
     ' e9 51 ff ff ff',    # jmp 0xa47f1af                 epilogue
     '(continued: the "only update the drop point" path)'),
]


def file_offset(data, va):
    phoff, = struct.unpack_from('<Q', data, 0x20)
    phentsize, phnum = struct.unpack_from('<HH', data, 0x36)
    for i in range(phnum):
        p_type, _, p_offset, p_vaddr, _, p_filesz = struct.unpack_from('<IIQQQQ', data, phoff + i * phentsize)
        if p_type == 1 and p_vaddr <= va < p_vaddr + p_filesz:
            return va - p_vaddr + p_offset
    raise SystemExit(f'{va:#x} is in no loaded segment')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        raise SystemExit(__doc__)
    path = args[0]
    data = bytearray(open(path, 'rb').read())
    sha = hashlib.sha256(data).hexdigest()
    if '--check' in sys.argv:
        print(f'{path}: {"patched" if sha == PATCHED else "NOT patched"} (Chromium X11 drag-and-drop fixes)')
        sys.exit(0 if sha == PATCHED else 1)
    if sha == PATCHED:
        print(f'{path}: already patched (Chromium X11 drag-and-drop fixes)')
        return
    if sha != UNPATCHED:
        raise SystemExit(f'{path}: not the Electron 45.3.3 linux-x64 binary (SHA256 {sha}); the Chromium X11 '
                         'drag-and-drop patches in build/patch-electron-linux.py are for that one (see its notes)')
    for va, old, new, what in PATCHES:
        old, new, off = bytes.fromhex(old), bytes.fromhex(new), file_offset(data, va)
        if len(old) != len(new) or data[off:off + len(old)] != old:
            raise SystemExit(f'{path}: unexpected bytes at {va:#x}; nothing changed')
        data[off:off + len(new)] = new
        print(f'  {va:#x}: {what}')
    sha = hashlib.sha256(data).hexdigest()
    if sha != PATCHED:
        raise SystemExit(f'{path}: patched SHA256 {sha} is not the expected {PATCHED}; nothing changed')
    tmp = path + '.patching'
    with open(tmp, 'wb') as f:
        f.write(data)
    shutil.copymode(path, tmp)
    os.replace(tmp, path)
    print(f'{path}: patched (Chromium X11 drag-and-drop fixes), SHA256 {sha}')


if __name__ == '__main__':
    main()
