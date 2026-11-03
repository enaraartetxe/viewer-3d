# Desktop apps · Programas de escritorio

**English** · [Castellano](#castellano)

`./empaquetar.sh` builds, into `salida/`:

- `Visor-3D.exe`: a single executable for Windows 10/11, no installer (uses the
  WebView2 that Windows already has).
- `Visor-3D-linux-x64.tar.gz`: the Linux binary and a README. Needs WebKitGTK
  (`libwebkit2gtk-4.1-0` on Ubuntu/Debian, `webkit2gtk4.1` on Fedora).
- `Visor-3D-mac.zip`: a universal `.app` (Intel and Apple Silicon). **Not
  tested on a real Mac yet.** Only built on macOS, because it needs an ad hoc
  signature (without it, it won't start on Apple Silicon); GitHub Actions does
  it on a Mac runner. Not signed by Apple, on purpose: users have to allow it
  once in System Settings → Privacy & Security → «Open Anyway».

How it works:

- It's the same app as `../` (index.html, estilo.css, main.js) inside a
  [Neutralino](https://neutralino.js.org/) window. three.js and its decoders
  (Draco, Basis/KTX2, Meshopt) and the glTF validator go inside: it works
  offline.
- Models can be opened by dropping them on the window, with «Abrir», or from
  the file manager («Open with → Visor 3D», or dropping them on the app's
  icon). In that case it also reads the textures and `.bin` files next to them.
- Gear icon → «Asociar», on Windows: copies the .exe to
  `%LOCALAPPDATA%\Programs\Visor 3D`, registers the model types under
  HKEY_CURRENT_USER (no admin rights) and adds a Start menu shortcut. «Quitar»
  undoes it. If the user had already chosen another default app, Windows keeps
  it: Visor 3D has to be picked once in «Open with → Always».
- Gear icon → «Asociar», on Linux: copies the binary to
  `~/.local/share/visor-3d/`, creates `~/.local/share/applications/visor-3d.desktop`
  (applications menu), declares the types in `~/.local/share/mime/packages/`
  and sets Visor 3D with `xdg-mime default`. No password. «Quitar» undoes it.
- On Mac the file types are declared in the `.app`'s `Info.plist` («Open with»
  in Finder). Untested: double-clicking a file sends macOS an event, not an
  argument, and Neutralino may not pick it up; dropping files on the window
  and «Abrir» do work.
- Recent files: the file name pill and the empty screen (desktop only).
- The .exe's icon and name come from `neutralino.config.json`
  (`applicationIcon`, `description`…), and `neu build` writes them into it. The
  Mac icon is `icono.icns`.
- Requirements: node and npm (and macOS for the Mac app). The first run
  downloads three.js, the validator and Neutralino's binaries into `.cache/`
  and `.obra/` (not in the repo).
- Pinned versions: `empaquetar.sh` (three, validator, neu) and
  `neutralino.config.json` (Neutralino). three must match the import map in
  `../index.html`.

### Publishing a new version

Raise `version` in `neutralino.config.json` and push to `main`: the
[workflow](../.github/workflows/publicar.yml) builds the three apps on a Mac
runner and creates the release `vX.Y.Z` with them (release notes:
`notas-version.md` plus the list of changes). It can also be run by hand from
the Actions tab; if that version is already released, it does nothing.

### Pending

- Try the Mac app on a real Mac (start, open with, double click).
- Linux ARM (arm64, armhf): Neutralino already builds them, but they aren't
  packaged.

---

## Castellano

`./empaquetar.sh` genera, en `salida/`:

- `Visor-3D.exe`: un único ejecutable para Windows 10/11, sin instalador (usa
  el WebView2 que ya trae Windows).
- `Visor-3D-linux-x64.tar.gz`: el binario de Linux y un README. Necesita
  WebKitGTK (`libwebkit2gtk-4.1-0` en Ubuntu/Debian, `webkit2gtk4.1` en Fedora).
- `Visor-3D-mac.zip`: un `.app` universal (Intel y Apple Silicon). **Sin
  probar todavía en un Mac de verdad.** Solo se genera en macOS, porque
  necesita una firma ad hoc (sin ella no arranca en Apple Silicon); lo hace
  GitHub Actions en un Mac. Sin firma de Apple, a propósito: hay que permitirlo
  una vez en Ajustes del Sistema → Privacidad y seguridad → «Abrir igualmente».

Cómo funciona:

- Es la misma app de `../` (index.html, estilo.css, main.js) dentro de una
  ventana de [Neutralino](https://neutralino.js.org/). three.js, sus
  decodificadores (Draco, Basis/KTX2, Meshopt) y el validador glTF van dentro:
  funciona sin conexión.
- Se puede abrir un modelo arrastrándolo a la ventana, con «Abrir» o desde el
  gestor de archivos («Abrir con → Visor 3D», o soltándolo sobre el icono del
  programa). En ese caso lee también las texturas y los `.bin` que tenga al lado.
- Engranaje → «Asociar», en Windows: copia el .exe a
  `%LOCALAPPDATA%\Programs\Visor 3D`, registra los tipos en HKEY_CURRENT_USER
  (sin administrador) y crea el acceso del menú Inicio. «Quitar» lo deshace.
  Si el usuario ya tenía otra app como predeterminada, Windows la respeta: hay
  que elegir Visor 3D una vez en «Abrir con → Siempre».
- Engranaje → «Asociar», en Linux: copia el binario a
  `~/.local/share/visor-3d/`, crea `~/.local/share/applications/visor-3d.desktop`
  (menú de aplicaciones), declara los tipos en `~/.local/share/mime/packages/`
  y elige Visor 3D con `xdg-mime default`. Sin contraseña. «Quitar» lo deshace.
- En Mac los tipos van declarados en el `Info.plist` del `.app` («Abrir con»
  del Finder). Sin probar: el doble clic en un archivo le llega a macOS como
  evento, no como argumento, y puede que Neutralino no lo recoja; arrastrar a
  la ventana y «Abrir» sí funcionan.
- Recientes: la pastilla del nombre y la pantalla vacía (solo en escritorio).
- El icono y el nombre del .exe salen de `neutralino.config.json`
  (`applicationIcon`, `description`…) y `neu build` los escribe en él. El
  icono de Mac es `icono.icns`.
- Requisitos: node y npm (y macOS para la app de Mac). La primera vez descarga
  three.js, el validador y los binarios de Neutralino en `.cache/` y `.obra/`
  (fuera del repo).
- Versiones fijadas: `empaquetar.sh` (three, validador, neu) y
  `neutralino.config.json` (Neutralino). three debe coincidir con el mapa de
  importación de `../index.html`.

### Publicar una versión nueva

Subir `version` en `neutralino.config.json` y hacer push a `main`: el
[flujo](../.github/workflows/publicar.yml) genera los tres programas en un Mac
de GitHub y crea la versión `vX.Y.Z` con ellos (notas: `notas-version.md` más
la lista de cambios). También se puede lanzar a mano desde la pestaña Actions;
si esa versión ya está publicada, no hace nada.

### Pendiente

- Probar la app de Mac en un Mac de verdad (arranque, abrir con, doble clic).
- Linux ARM (arm64, armhf): Neutralino ya los genera, pero no se empaquetan.
