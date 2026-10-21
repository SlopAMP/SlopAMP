"""Local extraction fixture; download, postprocessing and worker IPC remain real."""
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'macos'))
import yt_dlp
from slopamp.download_worker import main


class LocalFixtureDownloader(yt_dlp.YoutubeDL):
    def __exit__(self, *args):
        if child_pid := os.environ.get('SLOPAMP_FIXTURE_EXIT_CHILD_PID'):
            # Model an extractor/runtime descendant that survives the result
            # and inherits the stdout pipe. Shutdown must still own its group.
            child = subprocess.Popen(['/bin/sleep', '10'])
            Path(child_pid).write_text(str(child.pid))
        return super().__exit__(*args)

    def extract_info(self, url, download=True):
        live = os.environ.get('SLOPAMP_FIXTURE_LIVE_STATUS', 'not_live')
        return self.process_ie_result(dict(
            id='abcdefghijk', title='Download Fixture',
            url=os.environ['SLOPAMP_FIXTURE_MEDIA_URL'], ext='wav',
            acodec='pcm_s16le', vcodec='none',
            extractor='local-fixture', extractor_key='LocalFixture', webpage_url=url,
            live_status=live, is_live=live == 'is_live',
        ), download=download)


if __name__ == '__main__':
    raise SystemExit(main(LocalFixtureDownloader))
