#!/usr/bin/env bash
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

render() {
  rsvg-convert --width "$2" --height "$2" --output "$output_dir/$3" "$source_dir/$1"
}

if [ "$#" -eq 0 ]; then
  font_file="$source_dir/fonts/VarelaRound-Regular.ttf"
  export FONTCONFIG_FILE="$source_dir/fonts/fonts.conf"
  matched_font=$(fc-match -f '%{file}' 'Varela Round')
  if ! cmp -s "$font_file" "$matched_font"; then
    echo "Varela Round did not resolve to the bundled font: $matched_font" >&2
    exit 1
  fi
  output_dir="$source_dir/../images"
  mkdir -p "$output_dir"
  render v5-varela.svg 1024 icon.png
  render v3-foreground.svg 1024 android-icon-foreground.png
  if [ ! -f "$output_dir/android-icon-background.png" ]; then
    render v3-background.svg 1024 android-icon-background.png
  fi
  render v3-mono.svg 1024 android-icon-monochrome.png
  render v3-splash.svg 512 splash-icon.png
  render v3-splash-dark.svg 512 splash-icon-dark.png
  render v5-varela.svg 96 favicon.png
  exit 0
fi

output_dir=$1
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
