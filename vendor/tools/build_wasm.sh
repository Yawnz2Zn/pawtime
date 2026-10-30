#!/bin/sh
# Rebuild vendor/conv.wasm from vendor_src/conv.c  (needs clang with the wasm32 target and wasm-ld)
set -e
SRC="${1:-conv.c}"; OUT="${2:-conv.wasm}"
clang --target=wasm32 -O3 -msimd128 -mbulk-memory -nostdlib -ffreestanding -fno-builtin \
  -Wl,--no-entry -Wl,--import-memory -Wl,--initial-memory=1048576 -Wl,--max-memory=1073741824 \
  -Wl,-z,stack-size=65536 -Wl,--export=__heap_base -Wl,--strip-all \
  -o "$OUT" "$SRC"
echo "built $OUT ($(wc -c < "$OUT") bytes)"
