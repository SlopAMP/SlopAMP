"""py2app build definition; invoked through bin/build_macos.py."""
from setuptools import setup

setup(
    name='SlopAMP',
    version='1.2.0',
    app=['macos/run.py'],
    options={'py2app': {
        'dist_dir': 'dist/macos',
        'bdist_base': 'build/macos',
        'packages': ['slopamp', 'yt_dlp', 'yt_dlp_ejs'],
        'resources': ['src', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'build/icon-512.png'],
        'plist': {
            'CFBundleName': 'SlopAMP',
            'CFBundleDisplayName': 'SlopAMP',
            'CFBundleIdentifier': 'com.slopamp.macos',
            'CFBundleShortVersionString': '1.2.0',
            'LSMinimumSystemVersion': '12.0',
            'NSHighResolutionCapable': True,
            'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
            'CFBundleDocumentTypes': [{'CFBundleTypeName': 'Media and playlists', 'CFBundleTypeRole': 'Viewer', 'LSHandlerRank': 'Alternate', 'CFBundleTypeExtensions': ['mp3', 'flac', 'wav', 'm4a', 'mp4', 'mkv', 'mov', 'm3u', 'm3u8', 'pls']}],
        },
    }},
)
