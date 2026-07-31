#!/usr/bin/env bash
set -euo pipefail

export PATH="/mingw64/bin:/usr/bin:$PATH"

src="$(cygpath -u "$NRSC5_PORTABLE_SOURCE")"
rtl_native_src="$(cygpath -u "$NRSC5_PORTABLE_NATIVE_SOURCE")"
out="$(cygpath -u "$NRSC5_PORTABLE_BUILD")"
airspy_src="$(cygpath -u "$AIRSPYHF_PORTABLE_SOURCE")"
airspy_out="$(cygpath -u "$AIRSPYHF_PORTABLE_BUILD")"
airspy_native_src="$(cygpath -u "$AIRSPYHF_PORTABLE_NATIVE_SOURCE")"
redsea_src="$(cygpath -u "$REDSEA_PORTABLE_SOURCE")"
redsea_out="$(cygpath -u "$REDSEA_PORTABLE_BUILD")"
liquid_src="$(cygpath -u "$LIQUID_PORTABLE_SOURCE")"
liquid_out="$(cygpath -u "$LIQUID_PORTABLE_BUILD")"

cmake -S "$airspy_src/libairspyhf" -B "$airspy_out" -G "MSYS Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX=/mingw64
cmake --build "$airspy_out" --parallel 4
cmake --install "$airspy_out"

rm -rf "$liquid_out" "$redsea_out"
mkdir -p "$liquid_out"
cp -a "$liquid_src/." "$liquid_out/"
cd "$liquid_out"
perl -i -p -e 's/(AC_CHECK_LIB\(\[c\].+| sys\/resource.h)//g' configure.ac
./bootstrap.sh
./configure --prefix=/mingw64 --enable-fftoverride
make -j4
make install

meson setup "$redsea_out" "$redsea_src" --prefix=/mingw64 --buildtype=release
meson compile -C "$redsea_out"
meson install -C "$redsea_out"

gcc -O2 -I/mingw64/include/libairspyhf -o /mingw64/bin/airspyhf_info.exe \
  "$airspy_src/tools/src/airspyhf_info.c" /mingw64/bin/libairspyhf.dll.a

cmake -S "$src" -B "$out" -G "MSYS Makefiles" \
  -D USE_STATIC=OFF \
  -D USE_SYSTEM_LIBUSB=ON \
  -D USE_SYSTEM_RTLSDR=ON \
  -D USE_SYSTEM_LIBAO=ON \
  -D USE_SYSTEM_FFTW=ON \
  -D USE_SSE=ON \
  -D CMAKE_BUILD_TYPE=Release \
  -D CMAKE_INSTALL_PREFIX=/mingw64

gcc -O3 -Wall -Wextra -o "$out/rtl_hybrid.exe" \
  "$rtl_native_src/rtl_hybrid.c" -lrtlsdr -lm

gcc -O3 -Wall -Wextra -I/mingw64/include/libairspyhf -o "$out/airspyhf_hybrid.exe" \
  "$airspy_native_src/airspyhf_hybrid.c" /mingw64/bin/libairspyhf.dll.a -lm

cmake --build "$out" --parallel 4
cmake --install "$out"
