"""Pace a real FFmpeg input so process cancellation is deterministic in tests."""
import os
from pathlib import Path
import sys

args = sys.argv[1:]
if '-i' in args:
    Path(os.environ['SLOPAMP_FIXTURE_FFMPEG_PID']).write_text(str(os.getpid()))
    args.insert(args.index('-i'), '-re')
ffmpeg = os.environ['SLOPAMP_FIXTURE_FFMPEG']
os.execv(ffmpeg, [ffmpeg, *args])
