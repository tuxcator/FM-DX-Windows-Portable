#!/usr/bin/env bash
set -euo pipefail
export PATH="/mingw64/bin:/usr/bin:$PATH"
native_src="$(cygpath -u "$NRSC5_PORTABLE_NATIVE_SOURCE")"
out="$(cygpath -u "$NRSC5_PORTABLE_BUILD")"
mkdir -p "$out"
gcc -O3 -Wall -Wextra -o "$out/rtl_hybrid.exe" \
  "$native_src/rtl_hybrid.c" -lrtlsdr -lm
