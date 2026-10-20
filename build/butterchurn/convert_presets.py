"""Convert butterchurn-presets 2.4.7 JSON files into one JS file with precompiled equations.

Butterchurn normally turns each preset's equation strings into functions with `new Function`,
which SlopAMP's Content-Security-Policy forbids. Writing them out as real functions here keeps
the app free of eval(). Usage: python3 convert_presets.py <butterchurn-presets checkout> <out.js>
"""
import json, os, re, sys

root, out = sys.argv[1], sys.argv[2]
broken = set(n for n, _ in re.findall(r'presets\["(.*?)"\]\s*=\s*require\("([^"]+)"\)', open(os.path.join(root, 'src', 'broken.js')).read()))
d = os.path.join(root, 'presets', 'converted')
names = sorted(f[:-5] for f in os.listdir(d) if f.endswith('.json') and f[:-5] not in broken)
EQ = {'init_eqs_str', 'frame_eqs_str', 'pixel_eqs_str', 'point_eqs_str'}

def fn(code):
    return 'function(a){' + (code or '') + '\nreturn a;}'

def keep(o, skip):
    return {k: v for k, v in o.items() if k not in skip}

def obj(o):
    return '{' + json.dumps(o, separators=(',', ':'))[1:-1]

parts = []
for name in names:
    j = json.load(open(os.path.join(d, name + '.json')))
    s = obj(keep(j, EQ | {'shapes', 'waves'}))
    s += ',init_eqs:' + fn(j.get('init_eqs_str')) + ',frame_eqs:' + fn(j.get('frame_eqs_str'))
    s += ',pixel_eqs:' + (fn(j['pixel_eqs_str']) if j.get('pixel_eqs_str') else '""')
    shapes = []
    for x in j.get('shapes', []):
        o = obj(keep(x, EQ))
        if x.get('baseVals', {}).get('enabled', 0) != 0:
            o += ',init_eqs:' + fn(x.get('init_eqs_str')) + ',frame_eqs:' + fn(x.get('frame_eqs_str'))
        shapes.append(o + '}')
    waves = []
    for x in j.get('waves', []):
        o = obj(keep(x, EQ))
        if x.get('baseVals', {}).get('enabled', 0) != 0:
            o += ',init_eqs:' + fn(x.get('init_eqs_str')) + ',frame_eqs:' + fn(x.get('frame_eqs_str'))
            o += ',point_eqs:' + (fn(x['point_eqs_str']) if x.get('point_eqs_str') else '""')
        waves.append(o + '}')
    s += ',shapes:[' + ','.join(shapes) + '],waves:[' + ','.join(waves) + ']}'
    parts.append(json.dumps(name) + ':' + s)

with open(out, 'w') as f:
    f.write('/* Butterchurn presets from butterchurn-presets 2.4.7 (MIT): all presets except the ones the project marks broken. Equations precompiled so no eval() is needed. */\n')
    f.write('window.butterchurnPresets={\n' + ',\n'.join(parts) + '};\n')
print(len(names), 'presets written to', out)
