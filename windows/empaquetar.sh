#!/usr/bin/env bash
# Genera «Visor-3D.exe»: un único ejecutable para Windows 10/11, sin
# instalador. Usa Neutralino (ventana con el WebView2 que ya trae Windows) y
# lleva dentro la app y three, así que funciona sin conexión.
# Uso: ./empaquetar.sh   → windows/salida/Visor-3D.exe
set -euo pipefail
cd "$(dirname "$0")"

THREE_VERSION=0.186.0      # la misma del mapa de importación de index.html
VALIDADOR_VERSION=2.0.0-dev.3.10   # la misma de URL_VALIDADOR en main.js
NEU="npx -y @neutralinojs/neu@11.8.0"

obra=.obra                 # zona de trabajo (no va al repo); bin/ se reutiliza
mkdir -p "$obra" salida .cache
cp neutralino.config.json "$obra/"
rm -rf "$obra/resources" "$obra/dist"
mkdir -p "$obra/resources"

# App
cp ../index.html ../estilo.css ../main.js ../icono.svg ../icono.png "$obra/resources/"
cp -r ../entornos "$obra/resources/"

# three, en local
if [[ ! -d .cache/three-$THREE_VERSION ]]; then
  ( cd .cache && npm pack --silent "three@$THREE_VERSION" >/dev/null \
    && mkdir "three-$THREE_VERSION" && tar -xzf "three-$THREE_VERSION.tgz" -C "three-$THREE_VERSION" --strip-components=1 \
    && rm "three-$THREE_VERSION.tgz" )
fi
node recoger-three.mjs ".cache/three-$THREE_VERSION" ../main.js "$obra/resources/three"

# Validador glTF de Khronos (en la web se carga del CDN; aquí, dentro del .exe)
if [[ ! -d .cache/gltf-validator-$VALIDADOR_VERSION ]]; then
  ( cd .cache && npm pack --silent "gltf-validator@$VALIDADOR_VERSION" >/dev/null \
    && mkdir "gltf-validator-$VALIDADOR_VERSION" \
    && tar -xzf "gltf-validator-$VALIDADOR_VERSION.tgz" -C "gltf-validator-$VALIDADOR_VERSION" --strip-components=1 \
    && rm "gltf-validator-$VALIDADOR_VERSION.tgz" )
fi
mkdir -p "$obra/resources/vendor"
cp ".cache/gltf-validator-$VALIDADOR_VERSION/gltf_validator.dart.js" "$obra/resources/vendor/"
# Apache 2.0: su licencia y avisos viajan con él
cp ".cache/gltf-validator-$VALIDADOR_VERSION/LICENSE" "$obra/resources/vendor/gltf-validator.LICENSE"
cp ".cache/gltf-validator-$VALIDADOR_VERSION/NOTICES" "$obra/resources/vendor/gltf-validator.NOTICES"
cp ../LICENSE "$obra/resources/"

# index.html: mapa de importación local y cliente de Neutralino antes de main.js
python3 - "$obra/resources/index.html" <<'PY'
import re, sys
ruta = sys.argv[1]
html = open(ruta, encoding='utf-8').read()
html, n = re.subn(r'"three": "[^"]+"', '"three": "./three/build/three.module.js"', html)
html, m = re.subn(r'"three/addons/": "[^"]+"', '"three/addons/": "./three/addons/"', html)
assert n == 1 and m == 1, 'no encuentro el mapa de importación'
html = html.replace('<script type="module" src="main.js">',
                    '<script src="js/neutralino.js"></script>\n  <script type="module" src="main.js">', 1)
open(ruta, 'w', encoding='utf-8').write(html)
PY

# Binarios y cliente de Neutralino (se descargan una vez). El build pone al
# .exe el icono y el nombre «Visor 3D» (applicationIcon, description… del config):
# es lo que enseña Windows en el Explorador y en «Abrir con».
cd "$obra"
if [[ ! -f bin/neutralino-win_x64.exe || ! -f resources/js/neutralino.js ]]; then
  $NEU update >/dev/null
fi
$NEU build --release --embed-resources >/dev/null
cd ..

exe=$(find "$obra/dist" -name '*win_x64.exe' | head -1)
[[ -n "$exe" ]] || { echo "no se ha generado el .exe" >&2; exit 1; }
cp "$exe" "salida/Visor-3D.exe"
echo "listo: windows/salida/Visor-3D.exe ($(du -h salida/Visor-3D.exe | cut -f1))"
