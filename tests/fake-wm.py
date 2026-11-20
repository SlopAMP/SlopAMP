#!/usr/bin/env python3
"""A tiny X11 window manager for SlopAMP's Linux tests under xvfb (3.2.0), with GNOME's (Mutter's) fullscreen rule.

xvfb has no window manager, so nothing ever goes fullscreen there. This one manages windows just enough: it maps
them and sets WM_STATE, honours every move/resize, keeps _NET_WM_STATE for the EWMH client messages (skip taskbar /
pager, above, ...), and makes a window fullscreen (the whole screen, _NET_WM_STATE_FULLSCREEN) only when Mutter would:
a normal window (_NET_WM_WINDOW_TYPE_NORMAL, or no type and no WM_TRANSIENT_FOR) that can be resized (WM_NORMAL_HINTS
minimum != maximum). Dialogs are refused, as GNOME refuses them.
And GNOME's minimize (3.2.0 tray fix): a window minimized (WM_CHANGE_STATE Iconic) goes Iconic and
_NET_WM_STATE_HIDDEN, and so do the windows transient for it (they stay mapped; Electron then calls them minimized);
they come back when it's un-minimized (_NET_WM_STATE_HIDDEN removed), not when it's hidden and shown again. A window
that's withdrawn loses WM_STATE and _NET_WM_STATE, and a window mapped again starts Normal.
usage: fake-wm.py      (prints "ready", then one JSON line per fullscreen request ({"ev": "fullscreen", ...}) and per
                        minimize ({"ev": "minimize", "window": w, "with": [the transients hidden with it]}))
"""
import ctypes, json, sys

X = ctypes.CDLL('libX11.so.6')
c_ulong, c_long, c_int, c_uint, c_void_p, c_char_p = (ctypes.c_ulong, ctypes.c_long, ctypes.c_int, ctypes.c_uint,
                                                      ctypes.c_void_p, ctypes.c_char_p)
HEAD = [('type', c_int), ('serial', c_ulong), ('send_event', c_int), ('display', c_void_p)]


class MapReq(ctypes.Structure):
    _fields_ = HEAD + [('parent', c_ulong), ('window', c_ulong)]


class ConfReq(ctypes.Structure):
    _fields_ = HEAD + [('parent', c_ulong), ('window', c_ulong), ('x', c_int), ('y', c_int), ('width', c_int),
                       ('height', c_int), ('border_width', c_int), ('above', c_ulong), ('detail', c_int),
                       ('value_mask', c_ulong)]


class Unmap(ctypes.Structure):
    _fields_ = HEAD + [('event', c_ulong), ('window', c_ulong), ('from_configure', c_int)]


class Client(ctypes.Structure):
    _fields_ = HEAD + [('window', c_ulong), ('message_type', c_ulong), ('format', c_int), ('l', c_long * 5)]


class XEvent(ctypes.Union):
    _fields_ = [('type', c_int), ('map', MapReq), ('conf', ConfReq), ('unmap', Unmap), ('client', Client),
                ('pad', c_long * 24)]


class Changes(ctypes.Structure):
    _fields_ = [('x', c_int), ('y', c_int), ('width', c_int), ('height', c_int), ('border_width', c_int),
                ('sibling', c_ulong), ('stack_mode', c_int)]


ERR = ctypes.CFUNCTYPE(c_int, c_void_p, c_void_p)(lambda d, e: 0)    # windows come and go: never exit on X errors
X.XSetErrorHandler(ERR)
X.XOpenDisplay.restype, X.XOpenDisplay.argtypes = c_void_p, [c_char_p]
X.XDefaultRootWindow.restype, X.XDefaultRootWindow.argtypes = c_ulong, [c_void_p]
X.XDisplayWidth.argtypes = X.XDisplayHeight.argtypes = [c_void_p, c_int]
X.XInternAtom.restype, X.XInternAtom.argtypes = c_ulong, [c_void_p, c_char_p, c_int]
X.XSelectInput.argtypes = [c_void_p, c_ulong, c_long]
X.XSync.argtypes = [c_void_p, c_int]
X.XMapWindow.argtypes = [c_void_p, c_ulong]
X.XConfigureWindow.argtypes = [c_void_p, c_ulong, c_uint, ctypes.POINTER(Changes)]
X.XMoveResizeWindow.argtypes = [c_void_p, c_ulong, c_int, c_int, c_uint, c_uint]
X.XChangeProperty.argtypes = [c_void_p, c_ulong, c_ulong, c_ulong, c_int, c_int, c_void_p, c_int]
X.XDeleteProperty.argtypes = [c_void_p, c_ulong, c_ulong]
X.XGetWindowProperty.argtypes = [c_void_p, c_ulong, c_ulong, c_long, c_long, c_int, c_ulong, ctypes.POINTER(c_ulong),
                                 ctypes.POINTER(c_int), ctypes.POINTER(c_ulong), ctypes.POINTER(c_ulong),
                                 ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte))]
X.XFree.argtypes = [c_void_p]
X.XGetGeometry.argtypes = [c_void_p, c_ulong, ctypes.POINTER(c_ulong), ctypes.POINTER(c_int), ctypes.POINTER(c_int),
                           ctypes.POINTER(c_uint), ctypes.POINTER(c_uint), ctypes.POINTER(c_uint), ctypes.POINTER(c_uint)]
X.XTranslateCoordinates.argtypes = [c_void_p, c_ulong, c_ulong, c_int, c_int, ctypes.POINTER(c_int),
                                    ctypes.POINTER(c_int), ctypes.POINTER(c_ulong)]
X.XCreateSimpleWindow.restype = c_ulong
X.XCreateSimpleWindow.argtypes = [c_void_p, c_ulong, c_int, c_int, c_uint, c_uint, c_uint, c_ulong, c_ulong]
X.XPending.argtypes = [c_void_p]
X.XNextEvent.argtypes = [c_void_p, ctypes.POINTER(XEvent)]
MAP_REQUEST, CONFIGURE_REQUEST, UNMAP_NOTIFY, CLIENT_MESSAGE = 20, 23, 18, 33
SUBSTRUCTURE_NOTIFY, SUBSTRUCTURE_REDIRECT = 1 << 19, 1 << 20
XA_ATOM, XA_WINDOW, XA_CARDINAL = 4, 33, 6

dpy = X.XOpenDisplay(None)
if not dpy:
    sys.exit('no X display')
root = X.XDefaultRootWindow(dpy)
SW, SH = X.XDisplayWidth(dpy, 0), X.XDisplayHeight(dpy, 0)
A = lambda n: X.XInternAtom(dpy, n.encode(), 0)
NET_WM_STATE, FULLSCREEN, WM_STATE = A('_NET_WM_STATE'), A('_NET_WM_STATE_FULLSCREEN'), A('WM_STATE')
TYPE, NORMAL, TRANSIENT, HINTS = A('_NET_WM_WINDOW_TYPE'), A('_NET_WM_WINDOW_TYPE_NORMAL'), A('WM_TRANSIENT_FOR'), A('WM_NORMAL_HINTS')
CHANGE_STATE, HIDDEN = A('WM_CHANGE_STATE'), A('_NET_WM_STATE_HIDDEN')


def get(w, prop, n=32):
    t, f, items, after, data = c_ulong(), c_int(), c_ulong(), c_ulong(), ctypes.POINTER(ctypes.c_ubyte)()
    if X.XGetWindowProperty(dpy, w, prop, 0, n, 0, 0, ctypes.byref(t), ctypes.byref(f), ctypes.byref(items),
                            ctypes.byref(after), ctypes.byref(data)) != 0 or not t.value:
        return None
    vals = [ctypes.cast(data, ctypes.POINTER(c_long))[i] & 0xffffffff for i in range(items.value)] if f.value == 32 else []
    X.XFree(data)
    return vals


def set_atoms(w, prop, atoms, typ=XA_ATOM):
    arr = (c_long * max(1, len(atoms)))(*atoms)
    X.XChangeProperty(dpy, w, prop, typ, 32, 0, arr, len(atoms))


def geometry(w):
    r, x, y, wd, ht, b, d = c_ulong(), c_int(), c_int(), c_uint(), c_uint(), c_uint(), c_uint()
    X.XGetGeometry(dpy, w, ctypes.byref(r), ctypes.byref(x), ctypes.byref(y), ctypes.byref(wd), ctypes.byref(ht),
                   ctypes.byref(b), ctypes.byref(d))
    return x.value, y.value, wd.value, ht.value


def can_fullscreen(w):
    types = get(w, TYPE) or []
    normal = (types[0] == NORMAL) if types else not get(w, TRANSIENT)
    h = get(w, HINTS, 18) or []
    fixed = len(h) >= 9 and (h[0] & 16) and (h[0] & 32) and h[5] == h[7] and h[6] == h[8]    # PMinSize, PMaxSize
    return normal and not fixed, ('dialog' if not normal else 'not resizable' if fixed else '')


def set_hidden(w, on):         # GNOME's minimized look: Iconic, _NET_WM_STATE_HIDDEN (the window stays mapped)
    state = [a for a in (get(w, NET_WM_STATE) or []) if a != HIDDEN] + ([HIDDEN] if on else [])
    set_atoms(w, NET_WM_STATE, state)
    set_atoms(w, WM_STATE, [3 if on else 1, 0], WM_STATE)


def transients(w, seen=None):  # the managed windows transient for w, and theirs
    seen = seen or {w}
    out = []
    for t in list(managed):
        if t not in seen and (get(t, TRANSIENT) or [None])[0] == w:
            seen.add(t); out += [t] + transients(t, seen)
    return out


saved = {}
managed = set()
hidden_with = {}               # window -> the minimized window it was hidden with (itself when it was minimized)
X.XSelectInput(dpy, root, SUBSTRUCTURE_REDIRECT | SUBSTRUCTURE_NOTIFY)
X.XSync(dpy, 0)
check = X.XCreateSimpleWindow(dpy, root, -10, -10, 1, 1, 0, 0, 0)          # EWMH: a window manager is running
for w in (root, check):
    set_atoms(w, A('_NET_SUPPORTING_WM_CHECK'), [check], XA_WINDOW)
name = b'fake-wm'
X.XChangeProperty(dpy, check, A('_NET_WM_NAME'), A('UTF8_STRING'), 8, 0, name, len(name))
set_atoms(root, A('_NET_SUPPORTED'), [NET_WM_STATE, FULLSCREEN, A('_NET_WM_STATE_SKIP_TASKBAR'), A('_NET_WM_STATE_SKIP_PAGER'),
                                      A('_NET_WM_STATE_ABOVE'), HIDDEN, TYPE])     # no _NET_ACTIVE_WINDOW: Chromium focuses windows itself
X.XSync(dpy, 0)
print('ready', flush=True)

ev = XEvent()
while True:
    X.XNextEvent(dpy, ctypes.byref(ev))
    if ev.type == MAP_REQUEST:
        w = ev.map.window
        X.XMapWindow(dpy, w)
        managed.add(w); hidden_with.pop(w, None)
        set_hidden(w, False)                                                       # NormalState; the windows hidden with it stay so
    elif ev.type == CONFIGURE_REQUEST:
        c = ev.conf
        ch = Changes(c.x, c.y, c.width, c.height, c.border_width, c.above, c.detail)
        mask = c.value_mask & 0x1f | (c.value_mask & 0x40 if not c.value_mask & 0x20 else 0)    # stacking against a sibling: BadMatch
        X.XConfigureWindow(dpy, c.window, mask, ctypes.byref(ch))
    elif ev.type == UNMAP_NOTIFY:                                                  # withdrawn
        w = ev.unmap.window
        X.XDeleteProperty(dpy, w, WM_STATE)
        if w in managed:
            X.XDeleteProperty(dpy, w, NET_WM_STATE)
        managed.discard(w); hidden_with.pop(w, None)
    elif ev.type == CLIENT_MESSAGE and ev.client.message_type == CHANGE_STATE and ev.client.l[0] == 3:   # minimize
        w = ev.client.window
        if w in managed:
            hidden_with[w] = w; set_hidden(w, True)
            hid = [t for t in transients(w) if t not in hidden_with]
            for t in hid:
                hidden_with[t] = w; set_hidden(t, True)
            print(json.dumps({'ev': 'minimize', 'window': w, 'with': hid}), flush=True)
    elif ev.type == CLIENT_MESSAGE and ev.client.message_type == NET_WM_STATE:
        w, action = ev.client.window, ev.client.l[0]
        state = get(w, NET_WM_STATE) or []
        for atom in (ev.client.l[1] & 0xffffffff, ev.client.l[2] & 0xffffffff):
            if not atom:
                continue
            on = action == 1 or (action == 2 and atom not in state)
            if atom == FULLSCREEN:
                allowed, why = can_fullscreen(w)
                if on and allowed and atom not in state:
                    saved[w] = geometry(w)
                    X.XMoveResizeWindow(dpy, w, 0, 0, SW, SH)
                elif not on and w in saved:
                    X.XMoveResizeWindow(dpy, w, *saved.pop(w))
                print(json.dumps({'ev': 'fullscreen', 'window': w, 'on': on, 'allowed': allowed, 'why': why}), flush=True)
                on = on and allowed
            if atom == HIDDEN and not on and hidden_with.get(w) == w:                # un-minimized: its windows come back
                for t in [t for t, p in hidden_with.items() if p == w and t != w]:
                    hidden_with.pop(t); set_hidden(t, False)
                hidden_with.pop(w); set_atoms(w, WM_STATE, [1, 0], WM_STATE)
            state = [a for a in state if a != atom] + ([atom] if on else [])
        set_atoms(w, NET_WM_STATE, state)
    X.XSync(dpy, 0)
