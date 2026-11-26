#!/usr/bin/env bash
# Builds HolySic-TrollStore.tipa from the unsigned Release .app.
#
# Why a separate package: TrollStore keeps whatever entitlements the binaries already carry and
# only adds its TROLLTROLL fallback when the MAIN executable has none. HolySic ships an App Group,
# so without this script the app and the widget extension end up with no team-identifier and
# no application-identifier — iOS then refuses to register / run the widget plug-in and HolySic
# never appears in the widget gallery (TrollStore issue #873, uicache.m reads TeamIdentifier from
# com.apple.developer.team-identifier only).
#
#   scripts/ios/trollstore-sign.sh <path/to/HolySic.app> <app.entitlements> <widget.entitlements> <out.tipa>
set -euo pipefail

SRC_APP="$1"
APP_ENT_SRC="$2"
WIDGET_ENT_SRC="$3"
OUT="$4"

PB=/usr/libexec/PlistBuddy
WORK=$(mktemp -d)
mkdir -p "$WORK/Payload"
cp -R "$SRC_APP" "$WORK/Payload/"
APP="$WORK/Payload/$(basename "$SRC_APP")"
APPEX="$APP/PlugIns/HolySicWidget.appex"

APP_ID=$($PB -c "Print :CFBundleIdentifier" "$APP/Info.plist")
AEXE=$($PB -c "Print :CFBundleExecutable" "$APP/Info.plist")

# set KEY TYPE VALUE in a plist, replacing any previous value
put() {
  $PB -c "Delete :$2" "$1" >/dev/null 2>&1 || true
  $PB -c "Add :$2 $3 $4" "$1"
}

APP_ENT="$WORK/app.entitlements"
cp "$APP_ENT_SRC" "$APP_ENT"
put "$APP_ENT" application-identifier string "TROLLTROLL.$APP_ID"
put "$APP_ENT" com.apple.developer.team-identifier string TROLLTROLL
$PB -c "Delete :keychain-access-groups" "$APP_ENT" >/dev/null 2>&1 || true
$PB -c "Add :keychain-access-groups array" "$APP_ENT"
$PB -c "Add :keychain-access-groups:0 string TROLLTROLL.*" "$APP_ENT"
$PB -c "Delete :get-task-allow" "$APP_ENT" >/dev/null 2>&1 || true

if [ -d "$APPEX" ]; then
  WID=$($PB -c "Print :CFBundleIdentifier" "$APPEX/Info.plist")
  WEXE=$($PB -c "Print :CFBundleExecutable" "$APPEX/Info.plist")
  W_ENT="$WORK/widget.entitlements"
  cp "$WIDGET_ENT_SRC" "$W_ENT"
  put "$W_ENT" application-identifier string "TROLLTROLL.$WID"
  put "$W_ENT" com.apple.developer.team-identifier string TROLLTROLL
  # a sandboxed plug-in needs its own data container, or it is killed before the first snapshot
  put "$W_ENT" com.apple.private.security.container-required string "$WID"
  $PB -c "Delete :get-task-allow" "$W_ENT" >/dev/null 2>&1 || true
  # the shared App Group must be identical in both, it is how the widget reads "now playing"
  if ! $PB -c "Print :com.apple.security.application-groups" "$W_ENT" >/dev/null 2>&1; then
    $PB -c "Add :com.apple.security.application-groups array" "$W_ENT"
    $PB -c "Add :com.apple.security.application-groups:0 string group.com.holysic.music" "$W_ENT"
  fi
  rm -rf "$APPEX/_CodeSignature"
  # extension first, then the host app (the host seals its PlugIns)
  ldid -S"$W_ENT" "$APPEX/$WEXE"
  echo "::notice title=TrollStore widget entitlements::$(ldid -e "$APPEX/$WEXE" | tr -d '\n\t' | sed 's/  */ /g' | cut -c1-900)"
fi

if ! $PB -c "Print :com.apple.security.application-groups" "$APP_ENT" >/dev/null 2>&1; then
  $PB -c "Add :com.apple.security.application-groups array" "$APP_ENT"
  $PB -c "Add :com.apple.security.application-groups:0 string group.com.holysic.music" "$APP_ENT"
fi
rm -rf "$APP/_CodeSignature"
ldid -S"$APP_ENT" "$APP/$AEXE"
echo "::notice title=TrollStore app entitlements::$(ldid -e "$APP/$AEXE" | tr -d '\n\t' | sed 's/  */ /g' | cut -c1-900)"

OUT_ABS="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
(cd "$WORK" && zip -qry "$OUT_ABS" Payload)
rm -rf "$WORK"
ls -lh "$OUT_ABS"
