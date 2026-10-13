#!/bin/sh
# Converter export (scene + gameplay data) -> Godot import -> navmesh bake -> debug APK -> install and launch on the
# connected device -> app log. Run from anywhere: game/tools/build-android.sh
#   --no-convert   reuse game/assets/converted as is
#   --no-install   stop after building the APK
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
GODOT=${GODOT:-/c/Users/Nelson/Tools/godot/Godot_v4.7.2-stable_win64_console.exe}
ADB=${ADB:-"$LOCALAPPDATA/Android/Sdk/platform-tools/adb"}
APK="$ROOT/build/boz-remake.apk"
PACKAGE=org.nfelici.bozremake
CONVERT=1
INSTALL=1
for arg in "$@"; do
  case $arg in
    --no-convert) CONVERT=0 ;;
    --no-install) INSTALL=0 ;;
    *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done

if [ $CONVERT = 1 ]; then
  echo "== converter: export-kino + export-data"
  (cd "$ROOT/converter" && npm run --silent boz -- export-kino && npm run --silent boz -- export-data)
fi
mkdir -p "$ROOT/build"
echo "== godot: import"
"$GODOT" --headless --path "$ROOT/game" --import > "$ROOT/build/import.log" 2>&1
echo "== godot: bake navmesh"
"$GODOT" --headless --path "$ROOT/game" --script res://tools/bake_navmesh.gd 2>&1 | grep "^navmesh"
echo "== godot: tests"
status=0
"$GODOT" --headless --path "$ROOT/game" --script res://tests/run.gd > "$ROOT/build/tests.log" 2>&1 || status=$?
grep -E "^(ok|FAIL|info|skip|[0-9]+ failure)" "$ROOT/build/tests.log"
[ $status = 0 ] || { echo "tests failed (see build/tests.log)" >&2; exit 1; }
echo "== godot: export $APK"
mkdir -p "$ROOT/build"
"$GODOT" --headless --path "$ROOT/game" --export-debug Android "$APK" > "$ROOT/build/export.log" 2>&1
ls -l "$APK"
[ $INSTALL = 1 ] || exit 0

echo "== adb: install and launch"
"$ADB" install -r "$APK"
"$ADB" shell monkey -p $PACKAGE -c android.intent.category.LAUNCHER 1 > /dev/null
sleep 2
PID=$("$ADB" shell pidof $PACKAGE | tr -d '\r')
echo "== logcat for pid $PID (Ctrl+C to stop)"
"$ADB" logcat --pid="$PID"
