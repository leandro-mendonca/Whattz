#!/usr/bin/env bash
# ==============================================================================
# Instalador Automático Simplificado — Whattz E360 (Linux)
# Instala Node.js (se necessário), dependências do Electron, gera o instalador
# (.AppImage / .deb) e cria atalho no Menu de Aplicativos / Área de Trabalho.
# ==============================================================================
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "================================================================"
echo "⚡ Instalador Automático — Whattz E360 (Maricá / Enel RJ)"
echo "================================================================"

# 1. Verifica se Node.js está instalado; se não estiver, instala portable local em .runtime/node
if ! command -v node >/dev/null 2>&1; then
  echo "-> Node.js não encontrado no sistema. Baixando runtime Node.js LTS portátil..."
  mkdir -p "$APP_DIR/.runtime"
  NODE_VERSION="v20.18.1"
  ARCH="$(uname -m)"
  if [ "$ARCH" = "x86_64" ]; then
    NODE_ARCH="linux-x64"
  elif [ "$ARCH" = "aarch64" ]; then
    NODE_ARCH="linux-arm64"
  else
    NODE_ARCH="linux-x64"
  fi
  TARBALL="node-${NODE_VERSION}-${NODE_ARCH}.tar.xz"
  URL="https://nodejs.org/dist/${NODE_VERSION}/${TARBALL}"

  curl -fsSL "$URL" -o "$APP_DIR/.runtime/$TARBALL"
  tar -xJf "$APP_DIR/.runtime/$TARBALL" -C "$APP_DIR/.runtime"
  rm -f "$APP_DIR/.runtime/$TARBALL"
  export PATH="$APP_DIR/.runtime/node-${NODE_VERSION}-${NODE_ARCH}/bin:$PATH"
fi

echo "-> Node: $(node -v) | NPM: $(npm -v)"

# 2. Instala dependências do projeto (Electron e Electron-Builder)
echo "-> Instalando dependências do aplicativo..."
npm install

# 3. Executa os testes automatizados da fórmula da fatura
echo "-> Validando motor de cálculo (ANEEL / Enel RJ / ICMS RJ / COSIP Maricá)..."
npm test

# 4. Cria script lançador direto e atalho Desktop (.desktop) para o usuário
LAUNCHER="$APP_DIR/run-whattz.sh"
cat << 'EOF' > "$LAUNCHER"
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
unset ELECTRON_RUN_AS_NODE
export CHROME_DESKTOP="whattz.desktop"
if [ -d "$DIR/.runtime" ]; then
  NODE_BIN="$(find "$DIR/.runtime" -maxdepth 2 -name "bin" -type d | head -n 1)"
  export PATH="$NODE_BIN:$PATH"
fi
cd "$DIR"
exec "$DIR/node_modules/.bin/electron" . --class=whattz --name=whattz "$@"
EOF
chmod +x "$LAUNCHER"

mkdir -p "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps" "$HOME/.local/share/icons/hicolor/256x256/apps" "$HOME/.icons"
if [ -f "$APP_DIR/assets/icon.png" ]; then
  cp "$APP_DIR/assets/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/whattz.png"
  cp "$APP_DIR/assets/icon.png" "$HOME/.icons/whattz.png"
fi
if [ -f "$APP_DIR/assets/icon-256.png" ]; then
  cp "$APP_DIR/assets/icon-256.png" "$HOME/.local/share/icons/hicolor/256x256/apps/whattz.png"
fi
DESKTOP_FILE="$HOME/.local/share/applications/whattz.desktop"
cat << EOF > "$DESKTOP_FILE"
[Desktop Entry]
Name=Whattz E360
Comment=Controle diário de consumo de energia elétrica (Maricá / Enel RJ)
Exec="$LAUNCHER" %U
Icon=$APP_DIR/assets/icon.png
StartupWMClass=whattz
Terminal=false
Type=Application
Categories=Utility;Finance;
EOF
chmod +x "$DESKTOP_FILE"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "================================================================"
echo "✅ Instalação concluída com sucesso!"
echo "   - Para abrir agora: ./run-whattz.sh  (ou pelo Menu de Aplicativos: 'Whattz E360')"
echo "   - Para gerar instaladores (.AppImage / .deb): npm run dist:linux"
echo "================================================================"
