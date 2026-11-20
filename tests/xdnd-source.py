#!/usr/bin/env python3
"""A fake XDND drag source for SlopAMP's Linux tests (3.2.0).

Drags data onto an X11 window the way GNOME's XWayland bridge (Mutter) does for a drag that comes from a native
Wayland app such as Chrome: XdndEnter (version 5, the types in XdndTypeList when there are more than 3), XdndPosition
with XdndActionCopy, the data when the window asks for it (a type can be set to fail, as Mutter answers when the
Wayland app sends nothing for it), XdndDrop, then it waits for XdndFinished. No pointer moves; plain Xlib via ctypes.

usage: xdnd-source.py WINDOW X Y SPEC.json
  WINDOW  the target's X11 window id;  X Y  the drop point in root (screen) coordinates
  SPEC    {"types": [{"name": "text/plain", "text": "..." | "hex": "...", "fail": false}, ...],
           "positions": 3,     how many XdndPosition messages before the drop
           "motion_ms": 0,     0: the next position only after the window's XdndStatus (a polite source);
                               N: a position every N ms whatever the window says, as Mutter sends one for every
                               pointer motion (then more until the window accepts, and the drop)
           "delay_ms": 0,      each data request answered this long after it comes (Mutter asking the Wayland app)
           "release_ms": N,    GNOME's rule for the end of a drag: exactly `positions` positions, `motion_ms` (default
                               16) apart, whatever the window says; the mouse button is let go N ms after the last one, and
                               then it's XdndDrop if the window's last XdndStatus (from whoever sent it) accepted, else
                               XdndLeave (GNOME cancels the drag: "nothing happens")
           "drop": true, "timeout": 8}
Prints one JSON object per line: {"ev": "convert" | "status" | "finished" | "timeout", ...}
"""
import ctypes, json, sys, time

X = ctypes.CDLL('libX11.so.6')
c_ulong, c_long, c_int, c_uint, c_void_p, c_char_p = (ctypes.c_ulong, ctypes.c_long, ctypes.c_int, ctypes.c_uint,
                                                      ctypes.c_void_p, ctypes.c_char_p)


class XClientMessageEvent(ctypes.Structure):
    _fields_ = [('type', c_int), ('serial', c_ulong), ('send_event', c_int), ('display', c_void_p),
                ('window', c_ulong), ('message_type', c_ulong), ('format', c_int), ('l', c_long * 5)]


class XSelectionRequestEvent(ctypes.Structure):
    _fields_ = [('type', c_int), ('serial', c_ulong), ('send_event', c_int), ('display', c_void_p),
                ('owner', c_ulong), ('requestor', c_ulong), ('selection', c_ulong), ('target', c_ulong),
                ('property', c_ulong), ('time', c_ulong)]


class XSelectionEvent(ctypes.Structure):
    _fields_ = [('type', c_int), ('serial', c_ulong), ('send_event', c_int), ('display', c_void_p),
                ('requestor', c_ulong), ('selection', c_ulong), ('target', c_ulong), ('property', c_ulong),
                ('time', c_ulong)]


class XEvent(ctypes.Union):
    _fields_ = [('type', c_int), ('xclient', XClientMessageEvent), ('xselectionrequest', XSelectionRequestEvent),
                ('xselection', XSelectionEvent), ('pad', c_long * 24)]


X.XOpenDisplay.restype, X.XOpenDisplay.argtypes = c_void_p, [c_char_p]
X.XDefaultRootWindow.restype, X.XDefaultRootWindow.argtypes = c_ulong, [c_void_p]
X.XCreateSimpleWindow.restype = c_ulong
X.XCreateSimpleWindow.argtypes = [c_void_p, c_ulong, c_int, c_int, c_uint, c_uint, c_uint, c_ulong, c_ulong]
X.XInternAtom.restype, X.XInternAtom.argtypes = c_ulong, [c_void_p, c_char_p, c_int]
X.XSetSelectionOwner.argtypes = [c_void_p, c_ulong, c_ulong, c_ulong]
X.XChangeProperty.argtypes = [c_void_p, c_ulong, c_ulong, c_ulong, c_int, c_int, c_void_p, c_int]
X.XSendEvent.restype, X.XSendEvent.argtypes = c_int, [c_void_p, c_ulong, c_int, c_long, ctypes.POINTER(XEvent)]
X.XFlush.argtypes = [c_void_p]
X.XPending.restype, X.XPending.argtypes = c_int, [c_void_p]
X.XNextEvent.argtypes = [c_void_p, ctypes.POINTER(XEvent)]
CLIENT_MESSAGE, SELECTION_REQUEST, SELECTION_NOTIFY, XA_ATOM, PROP_REPLACE = 33, 30, 31, 4, 0


def out(**kw):
    print(json.dumps(kw), flush=True)


def main():
    target, x, y = int(sys.argv[1], 0), int(sys.argv[2]), int(sys.argv[3])
    spec = json.load(open(sys.argv[4]))
    dpy = X.XOpenDisplay(None)
    if not dpy:
        sys.exit('no X display')
    atom = lambda n: X.XInternAtom(dpy, n.encode(), 0)
    root = X.XDefaultRootWindow(dpy)
    src = X.XCreateSimpleWindow(dpy, root, 0, 0, 1, 1, 0, 0, 0)
    types = spec['types']
    atoms = [atom(t['name']) for t in types]
    by_atom = dict(zip(atoms, types))
    arr = (c_ulong * len(atoms))(*atoms)
    X.XChangeProperty(dpy, src, atom('XdndTypeList'), XA_ATOM, 32, PROP_REPLACE, arr, len(atoms))
    X.XSetSelectionOwner(dpy, atom('XdndSelection'), src, 0)

    def send(name, data):
        ev = XEvent()
        ev.xclient.type, ev.xclient.window, ev.xclient.message_type, ev.xclient.format = CLIENT_MESSAGE, target, atom(name), 32
        for i, v in enumerate(data):
            ev.xclient.l[i] = v
        X.XSendEvent(dpy, target, 0, 0, ctypes.byref(ev))
        X.XFlush(dpy)

    def answer(req):                  # req: (requestor, selection, target, property, time)
        requestor, selection, tgt, prop, when = req
        t, prop = by_atom.get(tgt), prop or tgt
        ok = bool(t) and not t.get('fail')
        if ok:
            data = bytes.fromhex(t['hex']) if 'hex' in t else t.get('text', '').encode('utf-8')
            buf = ctypes.create_string_buffer(data, len(data))
            X.XChangeProperty(dpy, requestor, prop, tgt, 8, PROP_REPLACE, buf, len(data))
        n = XEvent()
        s = n.xselection
        s.type, s.requestor, s.selection, s.target, s.property, s.time = (SELECTION_NOTIFY, requestor, selection, tgt,
                                                                         prop if ok else 0, when)
        X.XSendEvent(dpy, requestor, 0, 0, ctypes.byref(n))
        X.XFlush(dpy)
        out(ev='convert', type=t['name'] if t else tgt, ok=ok)

    many = len(atoms) > 3
    send('XdndEnter', [src, (5 << 24) | (1 if many else 0)] + ([0, 0, 0] if many else (atoms + [0, 0, 0])[:3]))
    copy, status_atom, finished_atom = atom('XdndActionCopy'), atom('XdndStatus'), atom('XdndFinished')
    position = lambda: send('XdndPosition', [src, 0, (x << 16) | (y & 0xffff), 0, copy])
    motion, delay = float(spec.get('motion_ms', 0)) / 1000, float(spec.get('delay_ms', 0)) / 1000
    positions, sent, dropped, accepted, pending = int(spec.get('positions', 3)), 1, False, False, []
    position()
    next_move = time.time() + motion
    deadline = time.time() + float(spec.get('timeout', 8))
    ev = XEvent()

    def drop():
        nonlocal dropped
        dropped = True
        send('XdndDrop', [src, 0, 0])

    release = spec.get('release_ms')
    if release is not None:
        motion = motion or 0.016
        release_at = None

    while time.time() < deadline:
        now = time.time()
        while pending and pending[0][0] <= now:
            answer(pending.pop(0)[1])
        if release is not None and not dropped:
            if release_at is None and now >= next_move:
                if sent < positions:
                    position()
                    sent += 1
                    next_move = now + motion
                else:
                    release_at = now + float(release) / 1000 - motion
            elif release_at is not None and now >= release_at:
                if not accepted:
                    send('XdndLeave', [src, 0, 0])
                    out(ev='finished', accept=False, left=True)
                    return
                drop()
        elif motion and not dropped and now >= next_move:
            if sent < positions or not accepted:
                position()
                sent += 1
                next_move = now + motion
            elif spec.get('drop', True):
                drop()
        if not X.XPending(dpy):
            time.sleep(0.001)
            continue
        X.XNextEvent(dpy, ctypes.byref(ev))
        if ev.type == SELECTION_REQUEST:
            r = ev.xselectionrequest
            req = (r.requestor, r.selection, r.target, r.property, r.time)
            if delay:
                pending.append((now + delay, req))
            else:
                answer(req)
        elif ev.type == CLIENT_MESSAGE and ev.xclient.message_type == status_atom:
            accepted = bool(ev.xclient.l[1] & 1)
            out(ev='status', accept=accepted, action=int(ev.xclient.l[4]) == copy)
            if motion or release is not None:
                continue
            if sent < positions:
                sent += 1
                position()
            elif not dropped and spec.get('drop', True):
                if not accepted:
                    send('XdndLeave', [src, 0, 0])
                    out(ev='finished', accept=False, left=True)
                    return
                drop()
        elif ev.type == CLIENT_MESSAGE and ev.xclient.message_type == finished_atom:
            out(ev='finished', accept=bool(ev.xclient.l[1] & 1), action=int(ev.xclient.l[2]) == copy)
            return
    out(ev='timeout', dropped=dropped, accepted=accepted)


if __name__ == '__main__':
    main()
