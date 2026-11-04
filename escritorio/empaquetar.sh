#!/usr/bin/env bash
# Genera los programas de escritorio: un único ejecutable por sistema, sin
# instalador. Usa Neutralino (ventana con el navegador del sistema: WebView2 en
# Windows, WebKitGTK en Linux) y lleva dentro la app y three: funciona sin
# conexión.
# Uso: ./empaquetar.sh   → salida/Visor-3D.exe
#                          salida/Visor-3D-linux-x64.tar.gz
#                          salida/Visor-3D-mac.zip (solo en un Mac: firma ad hoc)
# En GitHub lo lanza .github/workflows/publicar.yml (en un Mac) al subir la
# versión de neutralino.config.json.
set -euo pipefail
cd "$(dirname "$0")"

THREE_VERSION=0.186.0      # la misma del mapa de importación de index.html
VALIDADOR_VERSION=2.0.0-dev.3.10   # la misma de URL_VALIDADOR en main.js
NEU="npx -y @neutralinojs/neu@11.8.0"
VERSION=$(node -p "require('./neutralino.config.json').version")

obra=.obra                 # zona de trabajo (no va al repo); bin/ se reutiliza
mkdir -p "$obra" salida .cache
cp neutralino.config.json "$obra/"
rm -rf "$obra/resources" "$obra/dist"
mkdir -p "$obra/resources"

# App
cp ../index.html ../estilo.css ../main.js ../idiomas.js ../icono.svg ../icono.png "$obra/resources/"
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
# es lo que enseña Windows en el Explorador y en «Abrir con». Los mismos
# recursos van dentro de los binarios de los demás sistemas.
cd "$obra"
if [[ ! -f bin/neutralino-win_x64.exe || ! -f resources/js/neutralino.js ]]; then
  $NEU update >/dev/null
fi
$NEU build --release --embed-resources >/dev/null
cd ..

exe=$(find "$obra/dist" -name '*win_x64.exe' | head -1)
[[ -n "$exe" ]] || { echo "no se ha generado el .exe" >&2; exit 1; }
cp "$exe" "salida/Visor-3D.exe"
echo "listo: salida/Visor-3D.exe ($(du -h salida/Visor-3D.exe | cut -f1))"

# Linux: el binario en un .tar.gz (así conserva el permiso de ejecución) con
# unas instrucciones. La instalación en el menú y el doble clic se hacen desde
# el engranaje de la app, como en Windows.
linux=$(find "$obra/dist" -name '*linux_x64' -type f | head -1)
[[ -n "$linux" ]] || { echo "no se ha generado el binario de Linux" >&2; exit 1; }
rm -rf salida/linux && mkdir -p salida/linux/Visor-3D
install -m 755 "$linux" salida/linux/Visor-3D/Visor-3D
cat > salida/linux/Visor-3D/README.txt <<'TXT'
Visor 3D for Linux (x64)

1. It needs WebKitGTK. On Ubuntu, Debian or Mint:
     sudo apt install libwebkit2gtk-4.1-0
   On Fedora: sudo dnf install webkit2gtk4.1
2. Open it: double-click Visor-3D, or from a terminal: ./Visor-3D
   You can also pass a model: ./Visor-3D model.glb
3. To add it to the applications menu and open models with a double click:
   gear icon → «Asociar».

---

Visor 3D para Linux (x64)

1. Necesita WebKitGTK. En Ubuntu, Debian o Mint:
     sudo apt install libwebkit2gtk-4.1-0
   En Fedora: sudo dnf install webkit2gtk4.1
2. Abrir: doble clic en Visor-3D, o desde una terminal: ./Visor-3D
   También se le puede pasar un modelo: ./Visor-3D modelo.glb
3. Para tenerlo en el menú de aplicaciones y abrir los modelos con doble
   clic: engranaje → «Asociar».

https://github.com/enaraartetxe/viewer-3d
TXT
tar -czf salida/Visor-3D-linux-x64.tar.gz -C salida/linux Visor-3D
echo "listo: salida/Visor-3D-linux-x64.tar.gz ($(du -h salida/Visor-3D-linux-x64.tar.gz | cut -f1))"

# Mac (sin probar en un Mac de verdad): un .app universal (Intel y Apple
# Silicon) con su icono y los tipos de archivo para «Abrir con». No está
# firmado con cuenta de Apple, solo «ad hoc»: sin eso no arranca en Apple
# Silicon. La firma ad hoc necesita macOS, así que en Linux o Windows se salta.
if [[ "$(uname)" == Darwin ]]; then
  mac=$(find "$obra/dist" -name '*mac_universal' -type f | head -1)
  [[ -n "$mac" ]] || { echo "no se ha generado el binario de Mac" >&2; exit 1; }
  app="salida/mac/Visor 3D.app"
  rm -rf salida/mac && mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  install -m 755 "$mac" "$app/Contents/MacOS/visor-3d"
  cp icono.icns "$app/Contents/Resources/"
  sed "s/@VERSION@/$VERSION/g" Info.plist > "$app/Contents/Info.plist"
  codesign --force --deep --sign - "$app"
  ( cd salida/mac && ditto -c -k --sequesterRsrc --keepParent "Visor 3D.app" ../Visor-3D-mac.zip )
  echo "listo: salida/Visor-3D-mac.zip ($(du -h salida/Visor-3D-mac.zip | cut -f1))"
else
  echo "Mac: se salta (la firma ad hoc necesita macOS; en GitHub se hace sola)"
fi
