#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
unset ELECTRON_RUN_AS_NODE
export CHROME_DESKTOP="whattz.desktop"

# Garante que o ícone e o arquivo .desktop estejam registrados no GNOME / Linux (Wayland e X11)
mkdir -p "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps" "$HOME/.local/share/icons/hicolor/256x256/apps" "$HOME/.icons" 2>/dev/null || true
if [ -f "$DIR/assets/icon.png" ]; then
  cp -f "$DIR/assets/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/whattz.png" 2>/dev/null || true
  cp -f "$DIR/assets/icon.png" "$HOME/.icons/whattz.png" 2>/dev/null || true
fi
if [ -f "$DIR/assets/icon-256.png" ]; then
  cp -f "$DIR/assets/icon-256.png" "$HOME/.local/share/icons/hicolor/256x256/apps/whattz.png" 2>/dev/null || true
fi

cat << EOF > "$HOME/.local/share/applications/whattz.desktop" 2>/dev/null || true
[Desktop Entry]
Name=Whattz E360
Comment=Controle diário de consumo de energia elétrica (Maricá / Enel RJ)
Exec="$DIR/run-whattz.sh" %U
Icon=$DIR/assets/icon.png
StartupWMClass=whattz
Terminal=false
Type=Application
Categories=Utility;Finance;
EOF
chmod +x "$HOME/.local/share/applications/whattz.desktop" 2>/dev/null || true
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

if [ -d "$DIR/.runtime" ]; then
  NODE_BIN="$(find "$DIR/.runtime" -maxdepth 2 -name "bin" -type d | head -n 1)"
  export PATH="$NODE_BIN:$PATH"
fi
cd "$DIR"
exec "$DIR/node_modules/.bin/electron" . --class=whattz --name=whattz "$@"

