#!/usr/bin/env bash
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output_dir=${1:-./out}
font_file="$source_dir/../fonts/Rubik-Black.ttf"
matched_font=$(fc-match -f '%{file}' 'Rubik Black:style=Black')

if ! cmp -s "$font_file" "$matched_font"; then
  echo "Rubik Black did not resolve to the bundled font: $matched_font" >&2
  exit 1
fi

mkdir -p "$output_dir"

for source in "$source_dir"/stamp-on-*.svg "$source_dir"/v[23]-*.svg; do
  name=${source##*/}
  name=${name%.svg}
  for size in 1024 180 60; do
    rsvg-convert --width "$size" --height "$size" --output "$output_dir/$name-$size.png" "$source"
  done
done
