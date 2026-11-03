# Visor 3D

Visor de modelos 3D para Windows y para el navegador: arrastras un modelo y lo
ves, con sus texturas y animaciones.

![Visor 3D con el rover Curiosity abierto](miniatura.webp)

**[Descargar para Windows](https://github.com/enaraartetxe/visor-3d/releases/latest/download/Visor-3D.exe)**
· **[Usar en el navegador](https://enaraartetxe.com/experimentos/visor-3d/)**

Un solo `.exe`, sin instalador ni conexión. Funciona en Windows 10 y 11, que
traen WebView2. Como el ejecutable no está firmado, la primera vez Windows
puede avisar: «Más información» → «Ejecutar de todas formas».

## Qué hace

- Abre GLB y glTF (también comprimidos con Draco, Meshopt o KTX2), ZIP con un
  glTF dentro, FBX, OBJ, STL, DAE, USDZ, 3MF y PLY.
- Animaciones: elegir, encadenar todas, repetir, velocidad. Si mueven el
  modelo, la cámara lo sigue.
- Inspección: arcilla, cuadrícula UV, normales y cada canal del material
  (color, rugosidad, metal, relieve, oclusión, emisión).
- Entornos HDRI (incluidos o el tuyo), fondos, luz y efectos (oclusión
  ambiental, resplandor, desenfoque).
- Piezas del modelo con ocultar y encuadrar, formas (morph targets) y cámaras
  del archivo.
- Medidas, regla entre dos puntos, validación glTF con el validador oficial de
  Khronos e informe de texturas.
- Captura en PNG y vídeo girando alrededor del modelo.
- Temas claro, oscuro y alto contraste.
- En Windows: abrir los modelos con doble clic (desde el engranaje) y
  archivos recientes.

## Cómo está hecho

HTML, CSS y JavaScript sin compilar, con [three.js](https://threejs.org).
La versión de Windows es la misma página dentro de una ventana de
[Neutralino](https://neutralino.js.org).

- `index.html`, `estilo.css`, `main.js`: la aplicación. Para probarla, sirve la
  carpeta con cualquier servidor local (por ejemplo `npx servez`).
- `windows/empaquetar.sh`: genera `windows/salida/Visor-3D.exe`. Necesita node
  y npm; detalles en [windows/README.md](windows/README.md).

## Hecho con IA

Idea, diseño, dirección y pruebas: Enara Artetxe. Código escrito con
**Claude Opus 5.5** (Anthropic), que figura como coautor en los commits.

## Licencias

Código bajo licencia [MIT](LICENSE). Incluye o descarga:

- [three.js](https://github.com/mrdoob/three.js) (MIT).
- [Neutralino](https://github.com/neutralinojs/neutralinojs) (MIT).
- [glTF-Validator](https://github.com/KhronosGroup/glTF-Validator) de Khronos
  (Apache 2.0).
- Los entornos HDRI son de [Poly Haven](https://polyhaven.com) (CC0); ver
  [entornos/CREDITOS.md](entornos/CREDITOS.md).
- Modelo de la imagen: Curiosity, de la NASA.
