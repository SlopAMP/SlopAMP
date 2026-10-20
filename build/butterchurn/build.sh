#!/usr/bin/env bash
# Rebuilds src/renderer/vendor/butterchurn.min.js and butterchurn-presets.js.
# Needs: git, python3, and esbuild (npx esbuild works).
#
# Butterchurn 2.6.7 (MIT, https://github.com/jberg/butterchurn, commit d90f271) is used
# because its presets run as plain JavaScript (3.x needs a WebAssembly toolchain).
# Presets: butterchurn-presets 2.4.7 (MIT, https://github.com/jberg/butterchurn-presets,
# commit d19bf03), everything except the pack the project marks "broken".
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../src/renderer/vendor"
WORK="${WORK:-$HERE/.work}"
mkdir -p "$WORK" "$OUT"

[ -d "$WORK/butterchurn" ] || git clone https://github.com/jberg/butterchurn.git "$WORK/butterchurn"
git -C "$WORK/butterchurn" checkout -q d90f271
[ -d "$WORK/butterchurn-presets" ] || git clone https://github.com/jberg/butterchurn-presets.git "$WORK/butterchurn-presets"
git -C "$WORK/butterchurn-presets" checkout -q d19bf03

# 1) engine: copy the source, turn the one AMD module (blankPreset.js) into an ES module, bundle.
rm -rf "$HERE/butterchurn-src"; mkdir -p "$HERE/butterchurn-src"
cp -r "$WORK/butterchurn/src" "$HERE/butterchurn-src/src"
python3 - "$HERE/butterchurn-src/src/blankPreset.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("define([], function() {", "const pmap = (function() {", 1)
i = s.rstrip().rfind('});')
s = s[:i] + '})();\nexport default pmap;\n' + s[i + 3:]
open(p, 'w').write(s)
PY
npx --yes esbuild@0.23.1 "$HERE/entry.js" --bundle --minify --format=iife --target=chrome120 \
  --alias:ecma-proposal-math-extensions="$HERE/mathshim.js" --outfile="$OUT/butterchurn.min.js"
rm -rf "$HERE/butterchurn-src"

# 2) presets: precompile each preset's equations into real functions so the app needs no eval().
python3 "$HERE/convert_presets.py" "$WORK/butterchurn-presets" "$OUT/butterchurn-presets.js"
echo "done"
