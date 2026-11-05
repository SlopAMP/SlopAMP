#!/bin/bash
# Sample videos and songs for the Library preview test (tests/library-preview.js), made with FFmpeg's own
# test sources: six different-looking videos, three songs with different waveforms and one with cover art.
# Usage: tests/make-media.sh [ffmpeg] [out dir]   (defaults: vendor/ffmpeg/linux/ffmpeg, tests/media)
set -e
cd "$(dirname "$0")/.."
FF=${1:-vendor/ffmpeg/linux/ffmpeg}; M=${2:-tests/media}
mkdir -p "$M"; cd "$M"
VENC=libopenh264; "$FF" -hide_banner -encoders 2>/dev/null | grep -q libx264 && VENC=libx264
mk() { "$FF" -v error -y -f lavfi -i "$1" -f lavfi -i "sine=frequency=$3:duration=6" -t 6 -c:v $VENC -b:v 1M -pix_fmt yuv420p -c:a aac -shortest "$2"; }
mk "mandelbrot=s=640x360:rate=25" "Night Drive (Official Video) [UyhAC0AZM4Y].mp4" 220
mk "life=s=640x360:mold=10:r=25:ratio=0.1:death_color=#3b1d5e:life_color=#ff7ad9" "Neon Garden Live Session [Q1w2E3r4T5y].mp4" 330
mk "cellauto=s=640x360:rule=110:r=25" "3 Jeeps destroyed in 3 seconds! [abcdefghij1].mp4" 440
mk "gradients=s=640x360:c0=#0a2a6b:c1=#36c5f0:x0=0:y0=0:x1=640:y1=360:speed=0.02:r=25" "Ocean Ambience 10 hours [a1B2c3D4e5F].mp4" 150
mk "testsrc2=s=640x360:r=25" "Test Card Countdown [z9Y8x7W6v5U].mp4" 600
mk "smptehdbars=s=640x360:r=25" "Old TV Bars [k3J4h5G6f7D].mp4" 1000
au() { "$FF" -v error -y -f lavfi -i "aevalsrc=$1:s=22050:d=40" -c:a libmp3lame -b:a 128k "$2"; }
au "sin(2*PI*220*t)*(0.15+0.85*gt(t\,5)*lt(t\,20)+0.85*gt(t\,26))*(0.7+0.3*sin(2*PI*2*t))" "Test Artist - Tone Song [abcdefghij4].mp3"
au "(random(0)*2-1)*exp(-mod(t\,0.5)*10)*(0.15+0.85*abs(sin(2*PI*t/24)))" "Beat Maker - Drum Loop [m4N5b6V7c8X].mp3"
au "sin(2*PI*330*t)*min(1\,t/15)*0.9" "Slow Build - Rising [p0O9i8U7y6T].mp3"
"$FF" -v error -y -ss 1 -i "Night Drive (Official Video) [UyhAC0AZM4Y].mp4" -frames:v 1 -vf "scale=500:500:force_original_aspect_ratio=increase,crop=500:500" cover.jpg
"$FF" -v error -y -i "Test Artist - Tone Song [abcdefghij4].mp3" -i cover.jpg -map 0:a -map 1 -c copy -id3v2_version 3 -disposition:v attached_pic "Night Drive - Synthwave Mix [Uy1AC0AZM4Z].mp3"
rm -f cover.jpg
echo "sample media in $(pwd)"
