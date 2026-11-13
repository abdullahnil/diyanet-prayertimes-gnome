#!/usr/bin/env bash
# Installs Prayer Times Nil into the current user's GNOME Shell extensions folder.
set -euo pipefail

UUID="prayer-times-nil@abdullahnil"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

# ./install.sh --pack  ->  builds a zip for extensions.gnome.org instead of installing.
if [[ "${1:-}" == "--pack" ]]; then
    gnome-extensions pack "$SRC" --force --out-dir="$SRC" --extra-source=lib --extra-source=LICENSE
    echo "Paket: $SRC/$UUID.shell-extension.zip"
    exit 0
fi

glib-compile-schemas "$SRC/schemas"

mkdir -p "$DEST"
rm -rf "${DEST:?}/"*
cp -r "$SRC/metadata.json" "$SRC/extension.js" "$SRC/prefs.js" "$SRC/stylesheet.css" "$SRC/lib" "$SRC/schemas" "$SRC/LICENSE" "$DEST/"

echo "Kuruldu: $DEST"

if gnome-extensions info "$UUID" >/dev/null 2>&1; then
    gnome-extensions enable "$UUID" && echo "Eklenti etkinleştirildi."
    echo "Güncelleme sonrası değişikliklerin yüklenmesi için oturumu kapatıp açın (Wayland)."
else
    echo "GNOME Shell eklentiyi henüz tanımıyor (Wayland'de yeni eklentiler oturum açılışında yüklenir)."
    echo "1) Oturumu kapatıp tekrar açın"
    echo "2) Ardından: gnome-extensions enable $UUID"
fi
