#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
unset ELECTRON_RUN_AS_NODE
export CHROME_DESKTOP="whattz.desktop"

if [ -d "$DIR/.runtime" ]; then
  NODE_BIN="$(find "$DIR/.runtime" -maxdepth 2 -name "bin" -type d | head -n 1)"
  export PATH="$NODE_BIN:$PATH"
fi
cd "$DIR"
exec "$DIR/node_modules/.bin/electron" . --no-sandbox --class=whattz --name=whattz "$@"

