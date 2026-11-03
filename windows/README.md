# Visor 3D para Windows

`./empaquetar.sh` genera `salida/Visor-3D.exe`: un único ejecutable, sin
instalador, para Windows 10/11 (usa el WebView2 que ya trae Windows).

- Es la misma app de `../` (index.html, estilo.css, main.js) metida en una
  ventana de [Neutralino](https://neutralino.js.org/). three y sus
  decodificadores (Draco, Basis/KTX2, Meshopt) van dentro: funciona sin red.
- Se puede abrir un modelo arrastrándolo a la ventana, con el botón «Abrir», o
  desde el Explorador: «Abrir con → Visor 3D» o soltándolo sobre el icono del
  .exe. En ese caso lee también las texturas y los .bin que tenga al lado.
- Engranaje → «Asociar»: copia el .exe a `%LOCALAPPDATA%\Programs\Visor 3D`,
  registra .glb/.gltf/.fbx/.obj/.stl en HKEY_CURRENT_USER (sin administrador)
  y crea el acceso del menú Inicio. «Quitar» lo deshace. Si el usuario ya
  tenía otra app como predeterminada, Windows la respeta: hay que elegir Visor
  3D una vez en «Abrir con → Siempre».
- Recientes: la pastilla del nombre y la pantalla vacía (solo en el .exe).
- Icono y nombre del .exe: `applicationIcon`, `description`… de
  `neutralino.config.json`; `neu build` los escribe en el ejecutable.
- Requisitos para empaquetar: node y npm. La primera vez descarga three y los
  binarios de Neutralino (en `.cache/` y `.obra/`, fuera del repo).
- Versiones fijadas en `empaquetar.sh` (three, neu) y
  `neutralino.config.json` (Neutralino). three debe coincidir con el mapa de
  importación de `../index.html`.

## Pendiente: Mac y Linux

`neu build` ya genera los binarios de Mac (x64, arm64, universal) y Linux
(x64, arm64, armhf) en `.obra/dist/`; ahora solo se copia el de Windows.

- Mac: empaquetar con `--macos-bundle` para tener un `.app`. Sin firma de
  Apple Developer (99 $/año) Gatekeeper avisa: la primera vez, clic derecho →
  Abrir. La asociación de archivos va en el `Info.plist` del bundle
  (`CFBundleDocumentTypes`), no en el registro; el engranaje la oculta fuera
  de Windows.
- Linux: necesita WebKitGTK (suele venir). Asociación con un `.desktop` y
  `xdg-mime`.
- Las rutas de `vecinos()` en main.js usan `\`: revisarlas para Mac/Linux.
