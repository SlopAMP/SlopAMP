"""Source and bundled app entry point."""
import sys
from pathlib import Path
from slopamp.app import run

if __name__ == '__main__':
    resources = Path(__file__).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[1]
    if '--check-bundle' in sys.argv:
        from slopamp.bundle_check import check
        check(resources)
        raise SystemExit(0)
    if not getattr(sys, 'frozen', False):
        from slopamp.licenses import generate
        generate(resources)
    run(resources, [str(Path(p).resolve()) for p in sys.argv[1:] if not p.startswith('-psn_')])
