import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

const $ = (id) => document.getElementById(id);
const visor = $('visor');
const lienzo = $('lienzo');

// ── Escena ──────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const escena = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const estudio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
escena.environment = estudio;

const camara = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
camara.position.set(3, 2, 4);

const controles = new OrbitControls(camara, lienzo);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.autoRotateSpeed = 1.6;

const sol = new THREE.DirectionalLight(0xffffff, 1.6);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.bias = -0.0005;
sol.shadow.normalBias = 0.02;
escena.add(sol, sol.target);

const suelo = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ opacity: 0.16 })
);
suelo.receiveShadow = true;
escena.add(suelo);

let rejilla = null;
let modelo = null;      // grupo que envuelve lo cargado, ya centrado
let esqueleto = null;
let mezclador = null;
let clips = [];
let accion = null;
let radio = 1;
let urlsTemporales = [];

const opciones = { girar: false, rejilla: true, sombras: true, alambre: false, esqueleto: false, seguir: true, medidas: false };
let formatoActual = '';             // extensión del modelo abierto (glTF va en metros)
const cajaModelo = new THREE.Box3(); // caja del modelo ya centrado, para las medidas
let composer = null;                // solo existe con algún efecto encendido
const efectos = { ao: false, bloom: false, dof: false };
// Seguir la animación: puntos que se siguen, su centro al empezar y cuánto se ha movido
const seguimiento = { puntos: [], base: new THREE.Vector3(), desfase: new THREE.Vector3() };

// ── Cargadores ──────────────────────────────────────────────────

// Los decodificadores (Draco, Basis) viven junto a three; el mapa de
// importación dice dónde, tanto en la web (CDN) como en el .exe (local).
const rutaAddons = import.meta.resolve('three/addons/');

const gestor = new THREE.LoadingManager();
gestor.addHandler(/\.tga$/i, new TGALoader(gestor));

const draco = new DRACOLoader(gestor).setDecoderPath(rutaAddons + 'libs/draco/gltf/');
const ktx2 = new KTX2Loader(gestor).setTranscoderPath(rutaAddons + 'libs/basis/').detectSupport(renderer);

const cargadorGLTF = new GLTFLoader(gestor)
  .setDRACOLoader(draco)
  .setKTX2Loader(ktx2)
  .setMeshoptDecoder(MeshoptDecoder);

// ── Archivos: de lo que llega (sueltos, carpetas, zip) a un mapa ruta → blob

const EXT_MODELO = ['glb', 'gltf', 'fbx', 'obj', 'dae', 'usdz', 'usda', 'usdc', 'usd', '3mf', 'stl', 'ply'];
const extension = (ruta) => (ruta.match(/\.([^./\\]+)$/)?.[1] || '').toLowerCase();
const normalizar = (ruta) => {
  const partes = [];
  for (const p of ruta.replace(/\\/g, '/').toLowerCase().split('/')) {
    if (p === '..') partes.pop();
    else if (p && p !== '.') partes.push(p);
  }
  return partes.join('/');
};
const base = (ruta) => normalizar(ruta).split('/').pop();

async function expandirZips(lista) {
  const salida = [];
  for (const archivo of lista) {
    if (extension(archivo.ruta) !== 'zip') { salida.push(archivo); continue; }
    const contenido = unzipSync(new Uint8Array(await archivo.blob.arrayBuffer()));
    for (const [ruta, datos] of Object.entries(contenido)) {
      if (ruta.endsWith('/') || ruta.includes('__MACOSX/')) continue;
      salida.push({ ruta, blob: new Blob([datos]) });
    }
  }
  return salida;
}

function elegirPrincipal(lista) {
  for (const ext of EXT_MODELO) {
    const candidatos = lista.filter((a) => extension(a.ruta) === ext);
    // El menos anidado: en un zip suele ser el bueno
    candidatos.sort((a, b) => a.ruta.split('/').length - b.ruta.split('/').length);
    if (candidatos.length) return candidatos[0];
  }
  return null;
}

async function abrir(lista) {
  ocultarAviso();
  mostrarCarga('Leyendo…');
  try {
    lista = await expandirZips(lista);
    const principal = elegirPrincipal(lista);
    // Un HDRI sin modelo: se usa como entorno
    const hdri = lista.find((a) => ['hdr', 'exr'].includes(extension(a.ruta)));
    if (!principal && hdri) {
      mostrarCarga('Cargando entorno…');
      await entornoPropio(hdri.blob, extension(hdri.ruta));
      return 'entorno';
    }
    if (!principal) throw new Error('No encuentro ningún modelo (GLB, glTF, FBX, OBJ o STL) ni entorno (HDR, EXR) en lo que has abierto.');

    // Los recursos (texturas, .bin…) se buscan por ruta relativa al modelo y,
    // si no, por nombre: los FBX suelen traer rutas absolutas de otro equipo.
    for (const url of urlsTemporales) URL.revokeObjectURL(url);
    urlsTemporales = [];
    const porRuta = new Map();
    const porNombre = new Map();
    for (const a of lista) {
      const url = URL.createObjectURL(a.blob);
      urlsTemporales.push(url);
      porRuta.set(normalizar(a.ruta), url);
      if (!porNombre.has(base(a.ruta))) porNombre.set(base(a.ruta), url);
    }
    const carpeta = normalizar(principal.ruta).split('/').slice(0, -1).join('/');
    gestor.setURLModifier((url) => {
      if (/^(data|blob|https?):/i.test(url)) return url;
      let limpia = url.split(/[?#]/)[0];
      try { limpia = decodeURIComponent(limpia); } catch { /* tal cual */ }
      return porRuta.get(normalizar((carpeta ? carpeta + '/' : '') + limpia))
        || porRuta.get(normalizar(limpia))
        || porNombre.get(base(limpia))
        || url;
    });

    mostrarCarga('Cargando ' + base(principal.ruta) + '…');
    const resultado = await cargar(principal, lista);
    formatoActual = extension(principal.ruta);
    montar(resultado.objeto, resultado.animaciones);
    mostrarInfo(principal, lista);
    validar(principal);
    return true;
  } catch (error) {
    console.error(error);
    mostrarAviso(error?.message || 'No se ha podido abrir el archivo.');
    return false;
  } finally {
    ocultarCarga();
  }
}

async function cargar(principal, lista) {
  const ext = extension(principal.ruta);
  const buffer = await principal.blob.arrayBuffer();

  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await cargadorGLTF.parseAsync(buffer, '');
    return { objeto: gltf.scene || gltf.scenes[0], animaciones: gltf.animations };
  }
  if (ext === 'fbx') {
    const objeto = new FBXLoader(gestor).parse(buffer, '');
    await esperarRecursos();
    return { objeto, animaciones: objeto.animations };
  }
  if (ext === 'obj') {
    const cargador = new OBJLoader(gestor);
    const mtl = lista.find((a) => extension(a.ruta) === 'mtl');
    if (mtl) {
      const materiales = new MTLLoader(gestor).parse(await mtl.blob.text(), '');
      materiales.preload();
      cargador.setMaterials(materiales);
    }
    const objeto = cargador.parse(new TextDecoder().decode(buffer));
    await esperarRecursos();
    return { objeto, animaciones: [] };
  }
  if (ext === 'stl') {
    const geometria = new STLLoader().parse(buffer);
    geometria.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: geometria.hasColors ? 0xffffff : 0xd8d8de,
      vertexColors: !!geometria.hasColors,
      roughness: 0.55,
      metalness: 0.05,
    });
    return { objeto: new THREE.Mesh(geometria, material), animaciones: [] };
  }
  if (ext === 'dae') {
    const collada = new ColladaLoader(gestor).parse(new TextDecoder().decode(buffer), '');
    await esperarRecursos();
    return { objeto: collada.scene, animaciones: collada.scene.animations?.length ? collada.scene.animations : (collada.animations || []) };
  }
  if (['usdz', 'usda', 'usdc', 'usd'].includes(ext)) {
    const objeto = await new Promise((ok, mal) => new USDLoader(gestor).parse(buffer, '', ok, mal));
    return { objeto, animaciones: objeto.animations || [] };
  }
  if (ext === '3mf') {
    return { objeto: new ThreeMFLoader(gestor).parse(buffer), animaciones: [] };
  }
  if (ext === 'ply') {
    const geometria = new PLYLoader().parse(buffer);
    const conColor = !!geometria.attributes.color;
    // Con caras, malla; sin índice ni normales suele ser una nube de puntos
    if (geometria.index || geometria.attributes.normal) {
      if (!geometria.attributes.normal) geometria.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: conColor ? 0xffffff : 0xd8d8de, vertexColors: conColor, roughness: 0.6 });
      return { objeto: new THREE.Mesh(geometria, material), animaciones: [] };
    }
    geometria.computeBoundingSphere();
    const material = new THREE.PointsMaterial({ size: geometria.boundingSphere.radius * 0.004, vertexColors: conColor, color: conColor ? 0xffffff : 0x6b7280 });
    return { objeto: new THREE.Points(geometria, material), animaciones: [] };
  }
  throw new Error('Formato no compatible: .' + ext);
}

// Las texturas de FBX y OBJ llegan después del modelo: se espera a que el
// gestor termine (o a un tope, por si alguna no responde nunca).
let cargandoRecursos = false;
let alTerminar = [];
gestor.onStart = () => { cargandoRecursos = true; };
gestor.onLoad = () => { cargandoRecursos = false; alTerminar.splice(0).forEach((f) => f()); };
function esperarRecursos() {
  if (!cargandoRecursos) return Promise.resolve();
  return new Promise((resolver) => { alTerminar.push(resolver); setTimeout(resolver, 15000); });
}
gestor.onError = (url) => console.warn('No se ha podido cargar el recurso', url);

// ── Montar el modelo en escena ──────────────────────────────────

function quitarModelo() {
  if (!modelo) return;
  escena.remove(modelo);
  modelo.traverse((o) => {
    if (o.userData.materialOriginal) o.material = o.userData.materialOriginal;
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const valor of Object.values(m)) if (valor?.isTexture) valor.dispose();
      m.dispose();
    }
  });
  for (const porModo of derivados.values()) for (const m of porModo.values()) m.dispose();
  derivados.clear();
  if (esqueleto) { escena.remove(esqueleto); esqueleto.dispose(); esqueleto = null; }
  mezclador?.stopAllAction();
  mezclador = null;
  accion = null;
  clips = [];
  modelo = null;
}

function montar(objeto, animaciones) {
  quitarModelo();
  seguimiento.desfase.set(0, 0, 0);

  objeto.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      for (const m of [].concat(o.material)) {
        m.userData.alambreOriginal = !!m.wireframe;
        if (m.map) m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      }
    }
  });

  // Centrado y apoyado en el suelo
  modelo = new THREE.Group();
  modelo.add(objeto);
  const caja = new THREE.Box3().setFromObject(objeto);
  if (caja.isEmpty()) caja.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const centro = caja.getCenter(new THREE.Vector3());
  objeto.position.sub(new THREE.Vector3(centro.x, caja.min.y, centro.z));
  escena.add(modelo);

  const tam = caja.getSize(new THREE.Vector3());
  radio = Math.max(tam.length() / 2, 1e-4);
  cajaModelo.setFromObject(modelo);

  // Suelo, rejilla, luz y cámara a la escala del modelo
  suelo.scale.setScalar(radio * 40);
  colocarRejilla(tam);
  colocarLuz();
  camara.near = radio / 100;
  camara.far = radio * 200;
  camara.updateProjectionMatrix();
  controles.minDistance = radio * 0.05;
  controles.maxDistance = radio * 40;
  encuadrar(false, tam.y / 2);

  esqueleto = new THREE.SkeletonHelper(objeto);
  esqueleto.visible = opciones.esqueleto;
  if (esqueleto.bones.length) escena.add(esqueleto);
  else { esqueleto.dispose(); esqueleto = null; }

  aplicarInspeccion();

  clips = animaciones || [];
  mezclador = clips.length ? new THREE.AnimationMixer(objeto) : null;
  if (mezclador) {
    mezclador.timeScale = velocidad;
    mezclador.addEventListener('finished', alTerminarClip);
  }
  ponerEnCadena(false);
  pintarAnimaciones();
  if (clips.length) {
    elegirClip(0);
    mezclador.update(0);
  }
  prepararSeguimiento(objeto);
  $('reproductor').hidden = !clips.length;

  pintarFormas(objeto);
  pintarCamaras(objeto);
  pintarPiezas(objeto);
  $('lateral-vacio').hidden = true;
  pintarMedidas();
  borrarRegla();
  if (composer) prepararComposer();

  $('vacio').classList.add('oculto');
  for (const id of ['btn-encuadrar', 'btn-medir', 'btn-captura', 'btn-video']) $(id).disabled = false;
}

function colocarRejilla(tam) {
  if (rejilla) { escena.remove(rejilla); rejilla.geometry.dispose(); rejilla.material.dispose(); }
  // Lado redondo (1, 2, 5 × 10ⁿ) para que cada cuadro mida algo legible
  const objetivo = Math.max(tam.x, tam.z, tam.y * 0.6) * 3;
  const potencia = 10 ** Math.floor(Math.log10(objetivo));
  const lado = [1, 2, 5, 10].map((f) => f * potencia).find((v) => v >= objetivo);
  const oscuro = fondoActual === 'oceano' || fondoActual === 'noche';
  rejilla = new THREE.GridHelper(lado, 20, oscuro ? 0x8fa0b8 : 0xb4b8c2, oscuro ? 0x56647a : 0xd3d6dc);
  rejilla.material.transparent = true;
  rejilla.material.opacity = 0.55;
  rejilla.material.depthWrite = false;
  rejilla.position.y = radio * 0.0005;
  rejilla.visible = opciones.rejilla;
  escena.add(rejilla);
}

function colocarLuz() {
  const angulo = THREE.MathUtils.degToRad(+$('luz-angulo').value);
  sol.position.set(Math.cos(angulo) * radio * 2.2, radio * 3, Math.sin(angulo) * radio * 2.2).add(seguimiento.desfase);
  sol.target.position.copy(seguimiento.desfase);
  // El entorno gira con la luz, para que reflejos y sombra cuadren
  escena.environmentRotation.y = -angulo;
  escena.backgroundRotation.y = -angulo;
  const c = sol.shadow.camera;
  c.left = c.bottom = -radio * 1.5;
  c.right = c.top = radio * 1.5;
  c.near = radio * 0.1;
  c.far = radio * 8;
  c.updateProjectionMatrix();
  sol.castShadow = opciones.sombras;
  suelo.visible = opciones.sombras;
}

// Encuadre con transición suave
let viaje = null;
function encuadrar(suave = true, alturaCentro = null) {
  if (!modelo) return;
  if (alturaCentro === null) alturaCentro = new THREE.Box3().setFromObject(modelo).getCenter(new THREE.Vector3()).y;
  const destino = new THREE.Vector3(seguimiento.desfase.x, alturaCentro, seguimiento.desfase.z);
  const vfov = THREE.MathUtils.degToRad(camara.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camara.aspect);
  const distancia = radio / Math.sin(Math.min(vfov, hfov) / 2) * 1.08;
  const posicion = new THREE.Vector3(0.9, 0.55, 1.15).normalize().multiplyScalar(distancia).add(destino);
  if (!suave) {
    viaje = null;
    camara.position.copy(posicion);
    controles.target.copy(destino);
    controles.update();
    return;
  }
  viaje = {
    t: 0,
    desdePos: camara.position.clone(), haciaPos: posicion,
    desdeObj: controles.target.clone(), haciaObj: destino,
  };
}

// ── Estadísticas ────────────────────────────────────────────────

const compacto = (n) => n < 1000 ? String(n)
  : n < 1e6 ? (n / 1000).toLocaleString('es', { maximumFractionDigits: 1 }) + 'k'
  : (n / 1e6).toLocaleString('es', { maximumFractionDigits: 1 }) + 'M';
const tamano = (bytes) => bytes < 1024 ** 2
  ? Math.max(1, Math.round(bytes / 1024)) + ' KB'
  : (bytes / 1024 ** 2).toLocaleString('es', { maximumFractionDigits: 1 }) + ' MB';

function mostrarInfo(principal, lista) {
  let triangulos = 0, vertices = 0;
  const materiales = new Set(), texturas = new Set();
  modelo.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    const g = o.geometry;
    const veces = o.isInstancedMesh ? o.count : 1;
    vertices += g.attributes.position.count * veces;
    triangulos += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3) * veces;
    for (const m of [].concat(o.userData.materialOriginal ?? o.material)) {
      materiales.add(m);
      for (const valor of Object.values(m)) if (valor?.isTexture) texturas.add(valor.source ?? valor);
    }
  });

  const pesoTotal = lista.reduce((s, a) => s + a.blob.size, 0);
  $('dato-formato').textContent = extension(principal.ruta).toUpperCase();
  $('dato-peso').textContent = tamano(pesoTotal) + (lista.length > 1 ? ` · ${lista.length} archivos` : '');
  $('dato-triangulos').textContent = compacto(triangulos);
  $('dato-vertices').textContent = `triángulos · ${compacto(vertices)} vértices`;
  $('dato-materiales').textContent = materiales.size;
  const memoria = datosTexturas().reduce((suma, t) => suma + t.bytes, 0);
  $('dato-texturas').textContent = (texturas.size === 1 ? '1 textura' : `${texturas.size} texturas`)
    + (memoria ? ` · ${tamano(memoria)} en GPU` : '');
  $('btn-ver-texturas').hidden = !texturas.size;
  const t = cajaModelo.getSize(new THREE.Vector3());
  $('dato-medidas').textContent = [t.x, t.y, t.z].map(longitud).join(' × ');

  const nombreVisible = principal.nombreOriginal || principal.ruta.split(/[\\/]/).pop();
  nombreModelo = nombreVisible.replace(/\.[^.]+$/, '') || 'modelo';
  $('nombre-archivo').textContent = nombreVisible;
  $('pastilla').classList.add('lleno');
  document.title = `${nombreVisible} — Visor 3D`;
  window.Neutralino?.window.setTitle(document.title).catch(() => {});
}

// ── Animaciones ─────────────────────────────────────────────────

const reloj = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const nombreClip = (i) => clips[i].name || `Animación ${i + 1}`;
let velocidad = 1;
let pausado = false;
let indiceClip = 0;
let enCadena = false; // «Todas»: una detrás de otra y vuelta a empezar

// Secciones del panel: todas se pliegan igual
function plegar(boton, plegada) {
  $(boton.getAttribute('aria-controls')).hidden = plegada;
  boton.setAttribute('aria-expanded', String(!plegada));
}
for (const boton of document.querySelectorAll('.plegar')) {
  boton.addEventListener('click', () => plegar(boton, boton.getAttribute('aria-expanded') === 'true'));
}

function pintarAnimaciones() {
  const caja = $('lista-animaciones');
  caja.replaceChildren();
  $('num-animaciones').textContent = clips.length;
  $('btn-todas').hidden = clips.length < 2;
  $('btn-clips').disabled = clips.length < 2;
  if (!clips.length) return;
  clips.forEach((clip, i) => {
    const boton = document.createElement('button');
    boton.className = 'clip';
    boton.setAttribute('role', 'radio');
    boton.setAttribute('aria-checked', 'false');
    boton.title = nombreClip(i);
    const nombre = document.createElement('span');
    nombre.className = 'clip__nombre';
    nombre.textContent = nombreClip(i);
    const duracion = document.createElement('span');
    duracion.className = 'clip__duracion';
    duracion.textContent = clip.duration.toFixed(1).replace('.', ',') + ' s';
    boton.append(nombre, duracion);
    boton.addEventListener('click', () => { ponerEnCadena(false); elegirClip(i); cerrarMenus(); });
    caja.append(boton);
  });
}

function elegirClip(i) {
  if (!mezclador) return;
  terminada = false;
  const nueva = mezclador.clipAction(clips[i]);
  if (accion && accion !== nueva) {
    nueva.reset().play();
    accion.crossFadeTo(nueva, 0.25, false);
  } else {
    nueva.reset().play();
  }
  // En cadena o sin bucle, cada una se reproduce una vez y se queda en su final
  const unaVez = enCadena || !bucle;
  nueva.setLoop(unaVez ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  nueva.clampWhenFinished = unaVez;
  accion = nueva;
  indiceClip = i;
  accion.paused = pausado;
  [...$('lista-animaciones').children].forEach((b, j) => b.setAttribute('aria-checked', String(j === i)));
  $('clip-nombre').textContent = enCadena
    ? `${nombreClip(i)} · ${i + 1} de ${clips.length}`
    : nombreClip(i);
}

function ponerEnCadena(activa) {
  enCadena = activa;
  $('btn-todas').setAttribute('aria-pressed', String(activa));
  $('btn-todas').title = activa ? 'Dejar de encadenar' : 'Reproducir todas seguidas';
}
$('btn-todas').addEventListener('click', () => {
  if (!mezclador) return;
  ponerEnCadena(!enCadena);
  if (pausado) alternarPausa();
  // Al activar, desde la primera; al quitar, la actual sigue en bucle
  terminada = false;
  elegirClip(enCadena ? 0 : indiceClip);
});

// Al acabar una: en «Todas», la siguiente (y, con bucle, vuelta a empezar);
// si no, se queda parada al final hasta que se pulse de nuevo
let terminada = false;
function alTerminarClip(e) {
  if (e.action !== accion) return;
  const ultima = indiceClip === clips.length - 1;
  if (enCadena && (!ultima || bucle)) { elegirClip((indiceClip + 1) % clips.length); return; }
  terminada = true;
  ponerPausa(true);
}

function ponerPausa(valor) {
  pausado = valor;
  if (accion) accion.paused = valor;
  $('reproductor').classList.toggle('pausado', valor);
}

function alternarPausa() {
  if (!accion) return;
  // Si había terminado, play vuelve a empezar (en cadena, desde la primera)
  if (terminada) {
    terminada = false;
    ponerPausa(false);
    elegirClip(enCadena ? 0 : indiceClip);
    return;
  }
  ponerPausa(!pausado);
}

let bucle = true;
$('btn-bucle').addEventListener('click', () => {
  bucle = !bucle;
  $('btn-bucle').setAttribute('aria-pressed', String(bucle));
  $('btn-bucle').title = bucle ? 'Repetir (activado)' : 'Repetir (desactivado)';
  if (!accion) return;
  if (!enCadena) {
    accion.setLoop(bucle ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    accion.clampWhenFinished = !bucle;
  }
});
$('btn-clips').addEventListener('click', () => alternarMenu($('btn-clips'), $('menu-clips')));

$('btn-play').addEventListener('click', alternarPausa);
$('btn-velocidad').addEventListener('click', () => {
  velocidad = { 0.25: 0.5, 0.5: 1, 1: 2, 2: 0.25 }[velocidad];
  $('btn-velocidad').textContent = String(velocidad).replace('.', ',') + '×';
  if (mezclador) mezclador.timeScale = velocidad;
});

let arrastrandoLinea = false;
const linea = $('clip-linea');
linea.addEventListener('pointerdown', () => { arrastrandoLinea = true; });
addEventListener('pointerup', () => { arrastrandoLinea = false; });
linea.addEventListener('input', () => {
  if (!accion) return;
  accion.time = +linea.value * accion.getClip().duration;
  mezclador.update(0);
  pintarRelleno(linea);
});

// ── Opciones de vista, fondo y luz ──────────────────────────────

function aplicarAlambre() {
  modelo?.traverse((o) => {
    if (o.isMesh) for (const m of [].concat(o.material)) m.wireframe = opciones.alambre || m.userData.alambreOriginal;
  });
}

function cambiarOpcion(nombre, valor = !opciones[nombre]) {
  opciones[nombre] = valor;
  if (nombre === 'girar') controles.autoRotate = valor;
  if (nombre === 'rejilla' && rejilla) rejilla.visible = valor;
  if (nombre === 'sombras') { sol.castShadow = valor; suelo.visible = valor; }
  if (nombre === 'alambre') aplicarAlambre();
  if (nombre === 'esqueleto' && esqueleto) esqueleto.visible = valor;
  if (nombre === 'medidas') pintarMedidas();
  document.querySelector(`[data-opcion="${nombre}"]`)?.setAttribute('aria-checked', String(valor));
}

for (const boton of document.querySelectorAll('[data-opcion]')) {
  boton.addEventListener('click', () => cambiarOpcion(boton.dataset.opcion));
}
$('btn-encuadrar').addEventListener('click', () => encuadrar());
$('btn-pantalla').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});

// Los fondos se pintan con CSS detrás del lienzo (transparente) y, en las
// capturas y vídeos, con un canvas 2D: los dos salen de estos datos.
const FONDOS = {
  claro:     { radial: true,  paradas: [[0, '#ffffff'], [0.7, '#eef0f3'], [1, '#e3e6ea']] },
  atardecer: { radial: false, paradas: [[0, '#f7a8bd'], [0.45, '#d6a5dc'], [0.8, '#a59ad9'], [1, '#8a86c9']] },
  oceano:    { radial: false, paradas: [[0, '#2a86c2'], [0.55, '#17558e'], [1, '#0c2c55']] },
  noche:     { radial: true,  paradas: [[0, '#3b3f4a'], [0.7, '#22252c'], [1, '#17191e']] },
};

function fondoCSS(nombre) {
  const { radial, paradas } = FONDOS[nombre];
  const lista = paradas.map(([p, c]) => `${c} ${p * 100}%`).join(', ');
  return radial ? `radial-gradient(ellipse at 50% 40%, ${lista})` : `linear-gradient(180deg, ${lista})`;
}

// Mismo dibujo que fondoCSS: elipse centrada en (50%, 40%) hasta la esquina más lejana
function pintarFondo(ctx, w, h) {
  // Con el entorno de fondo, el lienzo 3D ya es opaco: basta con negro debajo
  if (!FONDOS[fondoActual]) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return; }
  const { radial, paradas } = FONDOS[fondoActual];
  ctx.save();
  let gradiente;
  let x = 0, y = 0, ancho = w, alto = h;
  if (radial) {
    // Círculo estirado: se escala en vertical y se rellena el lienzo entero
    const cx = w / 2, cy = h * 0.4;
    const rx = Math.SQRT2 * Math.max(cx, w - cx);
    const k = Math.max(cy, h - cy) / Math.max(cx, w - cx);
    ctx.translate(cx, cy);
    ctx.scale(1, k);
    gradiente = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    x = -cx; y = -cy / k; alto = h / k;
  } else {
    gradiente = ctx.createLinearGradient(0, 0, 0, h);
  }
  for (const [p, c] of paradas) gradiente.addColorStop(p, c);
  ctx.fillStyle = gradiente;
  ctx.fillRect(x, y, ancho, alto);
  ctx.restore();
}

const ARCHIVOS_ENTORNO = { exterior: 'entornos/exterior.hdr', atardecer: 'entornos/atardecer.hdr' };
const entornos = new Map([['estudio', estudio]]);
let entornoActual = 'estudio';

let fondoActual = 'claro';
let fondoElegido = false; // mientras no se elija, el fondo sigue al tema

function ponerFondo(nombre) {
  fondoActual = nombre;
  const deEntorno = nombre === 'entorno';
  actualizarFondoEscena();
  visor.style.background = deEntorno ? '#000' : fondoCSS(nombre);
  const oscuro = deEntorno || nombre === 'oceano' || nombre === 'noche';
  visor.classList.toggle('visor--oscuro', oscuro);
  document.querySelectorAll('.muestra').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.fondo === nombre)));
  suelo.material.opacity = oscuro ? 0.35 : 0.16;
  if (modelo) colocarRejilla(new THREE.Box3().setFromObject(modelo).getSize(new THREE.Vector3()));
}
for (const boton of document.querySelectorAll('.muestra')) {
  boton.addEventListener('click', () => { fondoElegido = true; ponerFondo(boton.dataset.fondo); });
}
ponerFondo('claro');

function pintarRelleno(input) {
  const min = +input.min, max = +input.max;
  input.style.setProperty('--relleno', ((+input.value - min) / (max - min)) * 100 + '%');
}
const intensidad = $('luz-intensidad');
const angulo = $('luz-angulo');
function pintarLuz() {
  $('valor-intensidad').textContent = (+intensidad.value).toLocaleString('es', { maximumFractionDigits: 1 }) + '×';
  $('valor-angulo').textContent = angulo.value + '°';
  pintarRelleno(intensidad);
  pintarRelleno(angulo);
}
intensidad.addEventListener('input', () => { renderer.toneMappingExposure = +intensidad.value; pintarLuz(); });
angulo.addEventListener('input', () => { colocarLuz(); pintarLuz(); });
pintarLuz();
colocarLuz();

// ── Entorno (HDRI): ilumina y da reflejos; con «Fondo → Entorno» se ve ──


const equirectangular = (textura) => {
  textura.mapping = THREE.EquirectangularReflectionMapping;
  return textura;
};

async function ponerEntorno(nombre) {
  if (!entornos.has(nombre)) {
    mostrarCarga('Cargando entorno…');
    try {
      entornos.set(nombre, equirectangular(await new HDRLoader().loadAsync(ARCHIVOS_ENTORNO[nombre])));
    } catch (error) {
      console.error(error);
      mostrarAviso('No se ha podido cargar el entorno.');
      return;
    } finally {
      ocultarCarga();
    }
  }
  entornoActual = nombre;
  escena.environment = entornos.get(nombre);
  actualizarFondoEscena();
  document.querySelectorAll('#entornos [data-entorno]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.entorno === nombre)));
}

async function entornoPropio(blob, ext) {
  const url = URL.createObjectURL(blob);
  try {
    const textura = equirectangular(await (ext === 'exr' ? new EXRLoader() : new HDRLoader()).loadAsync(url));
    entornos.get('propio')?.dispose();
    entornos.set('propio', textura);
  } finally {
    URL.revokeObjectURL(url);
  }
  document.querySelector('#entornos [data-entorno="propio"]').hidden = false;
  await ponerEntorno('propio');
}

for (const boton of document.querySelectorAll('#entornos [data-entorno]')) {
  boton.addEventListener('click', () => ponerEntorno(boton.dataset.entorno));
}

const selectorHdri = $('selector-hdri');
$('btn-hdri').addEventListener('click', async () => {
  if (!window.Neutralino) { selectorHdri.click(); return; }
  const [ruta] = await Neutralino.os.showOpenDialog('Cargar entorno HDRI', {
    filters: [{ name: 'Entornos HDRI', extensions: ['hdr', 'exr'] }],
  }) || [];
  if (ruta) abrirDesdeEscritorio([ruta]);
});
selectorHdri.addEventListener('change', () => {
  const [archivo] = selectorHdri.files;
  selectorHdri.value = '';
  if (archivo) abrir([{ ruta: archivo.name, blob: archivo }]);
});

// ── Apariencia: claro, oscuro, alto contraste (o lo que diga el sistema) ──

const consultaOscuro = matchMedia('(prefers-color-scheme: dark)');
const consultaContraste = matchMedia('(prefers-contrast: more)');
let temaElegido = 'auto';

function aplicarTema() {
  const tema = temaElegido !== 'auto' ? temaElegido
    : consultaContraste.matches ? 'contraste'
    : consultaOscuro.matches ? 'oscuro' : 'claro';
  if (tema === 'claro') delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = tema;
  document.querySelectorAll('#temas [data-tema]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tema === temaElegido)));
  if (!fondoElegido) ponerFondo(tema === 'claro' ? 'claro' : 'noche');
}
consultaOscuro.addEventListener('change', aplicarTema);
consultaContraste.addEventListener('change', aplicarTema);
for (const boton of document.querySelectorAll('#temas [data-tema]')) {
  boton.addEventListener('click', () => {
    temaElegido = boton.dataset.tema;
    aplicarTema();
    guardarPreferencia('tema', temaElegido);
  });
}

// Preferencias: en el .exe, almacenamiento de Neutralino (el localStorage no
// dura: el puerto, y con él el origen, cambia en cada arranque)
async function leerPreferencia(clave) {
  try {
    return window.Neutralino ? await Neutralino.storage.getData(clave) : localStorage.getItem('visor3d.' + clave);
  } catch { return null; }
}
function guardarPreferencia(clave, valor) {
  if (window.Neutralino) Neutralino.storage.setData(clave, valor).catch(() => {});
  else localStorage.setItem('visor3d.' + clave, valor);
}
async function iniciarTema() {
  const guardado = await leerPreferencia('tema');
  if (['auto', 'claro', 'oscuro', 'contraste'].includes(guardado)) temaElegido = guardado;
  aplicarTema();
}

// ── Inspección: materiales, arcilla, cuadrícula UV, normales y canales ──
// Cada malla guarda su material original; los de inspección se crean una vez
// por material y modo, y se tiran al cambiar de modelo.

let modoInspeccion = 'materiales';
const derivados = new Map(); // material original → Map(modo → material)
let texturaArcilla = null;
let texturaCuadricula = null;

function crearArcilla() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(100, 86, 6, 128, 128, 128);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#d9d6d2');
  g.addColorStop(0.75, '#8d8984');
  g.addColorStop(1, '#3d3b39');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Cuadrícula de 8 × 8 con un color por casilla: se ve si la textura se
// estira, gira o salta de una pieza a otra
function crearCuadricula() {
  const n = 8, lado = 512, celda = lado / n;
  const c = document.createElement('canvas');
  c.width = c.height = lado;
  const ctx = c.getContext('2d');
  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      const tono = (col * 45 + fila * 11) % 360;
      ctx.fillStyle = `hsl(${tono} 60% ${(fila + col) % 2 ? 66 : 50}%)`;
      ctx.fillRect(col * celda, fila * celda, celda, celda);
      ctx.fillStyle = 'rgba(255, 255, 255, .85)';
      ctx.font = `600 ${celda * 0.3}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String.fromCharCode(65 + col) + (n - fila), (col + 0.5) * celda, (fila + 0.5) * celda);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Canales: qué mapa enseñar, de qué canal de color y qué valor si no hay mapa.
// Los datos (rugosidad, metal…) se enseñan tal cual, sin corrección de color.
const CANALES = {
  color:           { mapa: 'map',          canal: null, base: (m) => m.color?.clone() },
  rugosidad:       { mapa: 'roughnessMap', canal: 'g',  base: (m) => m.roughness },
  metal:           { mapa: 'metalnessMap', canal: 'b',  base: (m) => m.metalness },
  'mapa-normales': { mapa: 'normalMap',    canal: 'rgb', base: () => new THREE.Color(0.5, 0.5, 1) },
  oclusion:        { mapa: 'aoMap',        canal: 'r',  base: () => 1 },
  emision:         { mapa: 'emissiveMap',  canal: null, base: (m) => m.emissive?.clone().multiplyScalar(m.emissiveIntensity ?? 1) },
};

function crearDerivado(original, modo) {
  const comun = { side: original.side, alphaTest: original.alphaTest };
  if (modo === 'matcap') {
    texturaArcilla ??= crearArcilla();
    return new THREE.MeshMatcapMaterial({ ...comun, matcap: texturaArcilla, normalMap: original.normalMap ?? null });
  }
  if (modo === 'uv') {
    texturaCuadricula ??= crearCuadricula();
    return new THREE.MeshStandardMaterial({ ...comun, map: texturaCuadricula, roughness: 0.75 });
  }
  if (modo === 'normales') return new THREE.MeshNormalMaterial(comun);

  const { mapa, canal, base } = CANALES[modo];
  const textura = original[mapa] ?? null;
  let valor = base(original);
  if (valor === undefined || valor === null) valor = 0;
  const color = valor.isColor ? valor : new THREE.Color().setScalar(valor);
  const esDato = canal !== null;
  // Un dato sin mapa se enseña como gris de su valor (sin corrección sRGB)
  if (esDato && !valor.isColor) color.setScalar(Math.pow(valor, 2.2));
  if (esDato && valor.isColor) color.setRGB(color.r ** 2.2, color.g ** 2.2, color.b ** 2.2);
  const m = new THREE.MeshBasicMaterial({ ...comun, color, map: textura, toneMapped: false });
  if (esDato && textura) {
    m.onBeforeCompile = (sombreador) => {
      sombreador.fragmentShader = sombreador.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 texel = texture2D( map, vMapUv );
          diffuseColor.rgb *= pow( vec3( texel.${canal} ), vec3( 2.2 ) );
        #endif`);
    };
    m.customProgramCacheKey = () => 'canal-' + canal;
  }
  return m;
}

function materialPara(original, modo) {
  if (modo === 'materiales') return original;
  if (!derivados.has(original)) derivados.set(original, new Map());
  const porModo = derivados.get(original);
  if (!porModo.has(modo)) porModo.set(modo, crearDerivado(original, modo));
  return porModo.get(modo);
}

function aplicarInspeccion() {
  modelo?.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.materialOriginal ??= o.material;
    const original = o.userData.materialOriginal;
    o.material = Array.isArray(original)
      ? original.map((m) => materialPara(m, modoInspeccion))
      : materialPara(original, modoInspeccion);
  });
  aplicarAlambre();
}

function ponerInspeccion(modo) {
  modoInspeccion = modo;
  document.querySelectorAll('#cuerpo-inspeccion [data-modo]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.modo === modo)));
  aplicarInspeccion();
}
for (const boton of document.querySelectorAll('#cuerpo-inspeccion [data-modo]')) {
  boton.addEventListener('click', () => ponerInspeccion(boton.dataset.modo));
}

// ── Seguir la animación ─────────────────────────────────────────
// Si la animación desplaza el modelo (andar, saltar, una voltereta…), la
// cámara, la luz y su sombra van detrás, suavizado y solo en horizontal. Se
// sigue el centro de los huesos; sin huesos, el de las piezas.

const centro = new THREE.Vector3();
const auxiliar = new THREE.Vector3();

function centroDePuntos() {
  centro.set(0, 0, 0);
  for (const o of seguimiento.puntos) centro.add(o.getWorldPosition(auxiliar));
  return centro.divideScalar(seguimiento.puntos.length);
}

function prepararSeguimiento(objeto) {
  const huesos = [], piezas = [];
  objeto.traverse((o) => {
    if (o.isBone) huesos.push(o);
    else if ((o.isMesh || o.isPoints) && piezas.length < 200) piezas.push(o);
  });
  seguimiento.puntos = clips.length ? (huesos.length ? huesos : piezas) : [];
  if (seguimiento.puntos.length) seguimiento.base.copy(centroDePuntos());
}

function seguir(dt) {
  if (!opciones.seguir || !seguimiento.puntos.length) return;
  const c = centroDePuntos();
  const deseado = auxiliar.set(c.x - seguimiento.base.x, 0, c.z - seguimiento.base.z);
  const paso = deseado.sub(seguimiento.desfase).multiplyScalar(1 - Math.exp(-dt * 5));
  if (paso.lengthSq() < 1e-12) return;
  seguimiento.desfase.add(paso);
  camara.position.add(paso);
  controles.target.add(paso);
  sol.position.add(paso);
  sol.target.position.add(paso);
  if (viaje) for (const v of [viaje.desdePos, viaje.haciaPos, viaje.desdeObj, viaje.haciaObj]) v.add(paso);
}

// ── Formas (morph targets): un deslizador por nombre ────────────
// Si varias mallas comparten el nombre (cara, dientes, cejas…) se mueven juntas.

function pintarFormas(objeto) {
  const formas = new Map();
  objeto.traverse((o) => {
    if (!o.morphTargetDictionary || !o.morphTargetInfluences) return;
    for (const [nombre, i] of Object.entries(o.morphTargetDictionary)) {
      if (!formas.has(nombre)) formas.set(nombre, []);
      formas.get(nombre).push([o, i]);
    }
  });
  const caja = $('cuerpo-formas');
  caja.replaceChildren();
  $('seccion-formas').hidden = !formas.size;
  $('num-formas').textContent = formas.size;
  plegar($('btn-plegar-formas'), formas.size > 8);
  for (const [nombre, usos] of formas) {
    const [malla, indice] = usos[0];
    const etiqueta = document.createElement('label');
    etiqueta.className = 'deslizador';
    const fila = document.createElement('span');
    fila.className = 'deslizador__fila';
    const texto = document.createElement('span');
    texto.textContent = nombre;
    const valor = document.createElement('output');
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: 0, max: 1, step: 0.01, value: malla.morphTargetInfluences[indice] });
    const pintar = () => {
      valor.textContent = Math.round(+input.value * 100) + ' %';
      pintarRelleno(input);
    };
    input.addEventListener('input', () => {
      for (const [m, j] of usos) m.morphTargetInfluences[j] = +input.value;
      pintar();
    });
    fila.append(texto, valor);
    etiqueta.append(fila, input);
    caja.append(etiqueta);
    pintar();
  }
}
$('btn-restablecer-formas').addEventListener('click', () => {
  for (const input of $('cuerpo-formas').querySelectorAll('input')) {
    input.value = 0;
    input.dispatchEvent(new Event('input'));
  }
});

// ── Cámaras que trae el archivo ─────────────────────────────────

let camarasModelo = [];

function pintarCamaras(objeto) {
  camarasModelo = [];
  objeto.traverse((o) => { if (o.isCamera) camarasModelo.push(o); });
  $('seccion-camaras').hidden = !camarasModelo.length;
  $('num-camaras').textContent = camarasModelo.length;
  const caja = $('cuerpo-camaras');
  caja.replaceChildren();
  ['Libre (girar con el ratón)', ...camarasModelo.map((c, i) => c.name || `Cámara ${i + 1}`)].forEach((texto, i) => {
    const boton = document.createElement('button');
    boton.className = 'eleccion';
    boton.setAttribute('role', 'radio');
    boton.setAttribute('aria-checked', String(i === 0));
    boton.innerHTML = '<span class="eleccion__nombre"></span>';
    boton.firstChild.textContent = texto;
    boton.addEventListener('click', () => verDesde(i - 1));
    caja.append(boton);
  });
}

// Se copia la posición, el giro y el campo de visión de la cámara del archivo;
// luego se puede seguir girando desde ahí
function verDesde(indice) {
  [...$('cuerpo-camaras').children].forEach((b, i) => b.setAttribute('aria-checked', String(i === indice + 1)));
  viaje = null;
  if (indice < 0) {
    camara.fov = 40;
    camara.updateProjectionMatrix();
    encuadrar();
    return;
  }
  const origen = camarasModelo[indice];
  origen.updateWorldMatrix(true, false);
  const posicion = new THREE.Vector3(), giro = new THREE.Quaternion(), escala = new THREE.Vector3();
  origen.matrixWorld.decompose(posicion, giro, escala);
  if (origen.isPerspectiveCamera) camara.fov = origen.fov;
  camara.updateProjectionMatrix();
  const distancia = Math.max(posicion.distanceTo(cajaModelo.getCenter(new THREE.Vector3())), radio * 0.1);
  camara.position.copy(posicion);
  controles.target.copy(posicion).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(giro), distancia);
  camara.quaternion.copy(giro);
  controles.update();
}

// ── Piezas: árbol de la escena, con ojo para ocultar ────────────
// Se pinta por niveles al desplegar: hay modelos con miles de nodos.

const MAX_HIJOS = 300;
let resalte = null;
const hijosVisibles = (o) => o.children.filter((c) => !c.isBone);
const tipoNodo = (o) => o.isSkinnedMesh ? 'malla con huesos' : o.isMesh ? 'malla' : o.isPoints ? 'puntos'
  : o.isLight ? 'luz' : o.isCamera ? 'cámara' : 'grupo';

function pintarPiezas(objeto) {
  let mallas = 0;
  objeto.traverse((o) => { if (o.isMesh || o.isPoints) mallas++; });
  $('num-piezas').textContent = mallas;
  $('seccion-piezas').hidden = false;
  const caja = $('cuerpo-piezas');
  caja.replaceChildren(...nodosDe(hijosVisibles(objeto).length ? objeto : modelo, 0));
}

function nodosDe(padre, nivel) {
  const hijos = hijosVisibles(padre);
  const nodos = hijos.slice(0, MAX_HIJOS).map((h) => nodoArbol(h, nivel));
  if (hijos.length > MAX_HIJOS) {
    const mas = document.createElement('div');
    mas.className = 'arbol__mas';
    mas.textContent = `y ${hijos.length - MAX_HIJOS} más`;
    nodos.push(mas);
  }
  return nodos;
}

const SVG_FLECHA = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
const SVG_OJO = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>';

function nodoArbol(objeto, nivel) {
  const nodo = document.createElement('div');
  const fila = document.createElement('div');
  fila.className = 'nodo__fila';
  fila.style.paddingLeft = 10 + nivel * 14 + 'px';
  fila.classList.toggle('oculto', !objeto.visible);

  const abrir = document.createElement('button');
  abrir.className = 'nodo__abrir';
  abrir.innerHTML = SVG_FLECHA;
  abrir.setAttribute('aria-expanded', 'false');
  abrir.setAttribute('aria-label', 'Desplegar');
  const tieneHijos = hijosVisibles(objeto).length > 0;
  if (!tieneHijos) abrir.classList.add('sin-hijos');

  const nombre = document.createElement('span');
  nombre.className = 'nodo__nombre';
  nombre.textContent = objeto.name || '(sin nombre)';
  // El tipo va en la descripción: en la fila le quitaba sitio al nombre
  nombre.title = `${nombre.textContent} (${tipoNodo(objeto)}). Doble clic: encuadrar esta pieza`;

  const ojo = document.createElement('button');
  ojo.className = 'nodo__ojo';
  ojo.innerHTML = SVG_OJO;
  ojo.setAttribute('aria-pressed', String(objeto.visible));
  ojo.setAttribute('aria-label', 'Mostrar u ocultar');

  const hijos = document.createElement('div');
  hijos.className = 'nodo__hijos';
  hijos.hidden = true;

  abrir.addEventListener('click', () => {
    if (!tieneHijos) return;
    if (!hijos.childElementCount) hijos.append(...nodosDe(objeto, nivel + 1));
    hijos.hidden = !hijos.hidden;
    abrir.setAttribute('aria-expanded', String(!hijos.hidden));
  });
  ojo.addEventListener('click', () => {
    objeto.visible = !objeto.visible;
    ojo.setAttribute('aria-pressed', String(objeto.visible));
    fila.classList.toggle('oculto', !objeto.visible);
  });
  fila.addEventListener('mouseenter', () => resaltar(objeto));
  fila.addEventListener('mouseleave', () => resaltar(null));
  nombre.addEventListener('dblclick', () => encuadrarObjeto(objeto));

  fila.append(abrir, nombre, ojo);
  nodo.append(fila, hijos);
  return nodo;
}

function resaltar(objeto) {
  if (resalte) { escena.remove(resalte); resalte.dispose(); resalte = null; }
  if (!objeto) return;
  resalte = new THREE.BoxHelper(objeto, 0xf4675b);
  resalte.material.depthTest = false;
  resalte.renderOrder = 999;
  escena.add(resalte);
}

function encuadrarObjeto(objeto) {
  const caja = new THREE.Box3().setFromObject(objeto);
  if (caja.isEmpty()) return;
  const esfera = caja.getBoundingSphere(new THREE.Sphere());
  const direccion = camara.position.clone().sub(controles.target).normalize();
  const distancia = Math.max(esfera.radius, radio * 0.02) / Math.sin(THREE.MathUtils.degToRad(camara.fov) / 2) * 1.2;
  viaje = {
    t: 0,
    desdePos: camara.position.clone(), haciaPos: esfera.center.clone().addScaledVector(direccion, distancia),
    desdeObj: controles.target.clone(), haciaObj: esfera.center.clone(),
  };
}

// ── Medidas: caja del modelo y regla entre dos puntos ───────────
// glTF está en metros por norma; los demás formatos, en unidades sin nombre.

function longitud(valor) {
  const metros = formatoActual === 'glb' || formatoActual === 'gltf';
  const n = (v, d) => v.toLocaleString('es', { maximumFractionDigits: d });
  if (!metros) return n(valor, valor < 10 ? 3 : 1) + ' u';
  if (valor < 0.01) return n(valor * 1000, 1) + ' mm';
  if (valor < 1) return n(valor * 100, 1) + ' cm';
  return n(valor, 2) + ' m';
}

let cajaVisible = null;
const cotasCaja = [];

function cota(clase = '') {
  const el = document.createElement('span');
  el.className = 'cota ' + clase;
  el.hidden = true;
  $('cotas').append(el);
  return el;
}

function pintarMedidas() {
  if (cajaVisible) { escena.remove(cajaVisible); cajaVisible.dispose(); cajaVisible = null; }
  for (const c of cotasCaja) c.el.remove();
  cotasCaja.length = 0;
  if (!opciones.medidas || !modelo) return;
  cajaVisible = new THREE.Box3Helper(cajaModelo, 0x8a8f99);
  escena.add(cajaVisible);
  const { min, max } = cajaModelo;
  const centro = cajaModelo.getCenter(new THREE.Vector3());
  const t = cajaModelo.getSize(new THREE.Vector3());
  // Ancho en la arista de abajo delante, alto en una vertical, fondo abajo a un lado
  for (const [punto, valor] of [
    [new THREE.Vector3(centro.x, min.y, max.z), t.x],
    [new THREE.Vector3(max.x, centro.y, max.z), t.y],
    [new THREE.Vector3(max.x, min.y, centro.z), t.z],
  ]) {
    const el = cota();
    el.textContent = longitud(valor);
    cotasCaja.push({ punto, el });
  }
}

// Regla: con la herramienta activa, clic en dos puntos del modelo
let midiendo = false;
const regla = { puntos: [], grupo: new THREE.Group(), el: null };
escena.add(regla.grupo);
const rayo = new THREE.Raycaster();
let pulsadoEn = null;

function ponerRegla(activa) {
  midiendo = activa;
  $('btn-medir').setAttribute('aria-pressed', String(activa));
  visor.classList.toggle('midiendo', activa);
  if (!activa) borrarRegla();
}

function borrarRegla() {
  regla.puntos = [];
  for (const hijo of [...regla.grupo.children]) {
    regla.grupo.remove(hijo);
    hijo.geometry.dispose();
    hijo.material.dispose();
  }
  regla.el?.remove();
  regla.el = null;
}

const visibleDeVerdad = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

function marcarPunto(e) {
  const r = lienzo.getBoundingClientRect();
  rayo.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camara);
  const golpe = rayo.intersectObject(modelo, true).find((g) => visibleDeVerdad(g.object));
  if (!golpe) return;
  if (regla.puntos.length === 2) borrarRegla();
  regla.puntos.push(golpe.point.clone());

  const material = new THREE.MeshBasicMaterial({ color: 0xf4675b, depthTest: false });
  const bola = new THREE.Mesh(new THREE.SphereGeometry(radio * 0.008, 16, 12), material);
  bola.position.copy(golpe.point);
  bola.renderOrder = 1000;
  regla.grupo.add(bola);

  if (regla.puntos.length === 2) {
    const [a, b] = regla.puntos;
    const linea = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color: 0xf4675b, depthTest: false })
    );
    linea.renderOrder = 1000;
    regla.grupo.add(linea);
    regla.el = cota('cota--regla');
    regla.el.textContent = longitud(a.distanceTo(b));
  }
}

lienzo.addEventListener('pointerdown', (e) => { pulsadoEn = [e.clientX, e.clientY]; });
lienzo.addEventListener('pointerup', (e) => {
  // Solo un clic quieto: arrastrar sigue girando la cámara
  if (!midiendo || !modelo || !pulsadoEn) return;
  if (Math.hypot(e.clientX - pulsadoEn[0], e.clientY - pulsadoEn[1]) < 5) marcarPunto(e);
});
$('btn-medir').addEventListener('click', () => ponerRegla(!midiendo));

// Las etiquetas siguen a sus puntos en pantalla
const proyectado = new THREE.Vector3();
function colocarEtiqueta(el, punto) {
  proyectado.copy(punto).project(camara);
  const detras = proyectado.z > 1;
  el.hidden = detras;
  if (detras) return;
  el.style.left = (proyectado.x + 1) / 2 * visor.clientWidth + 'px';
  el.style.top = (1 - proyectado.y) / 2 * visor.clientHeight + 'px';
}
function colocarCotas() {
  for (const { punto, el } of cotasCaja) colocarEtiqueta(el, punto);
  if (regla.el) colocarEtiqueta(regla.el, regla.puntos[0].clone().lerp(regla.puntos[1], 0.5));
}

// ── Efectos: oclusión ambiental, resplandor y desenfoque ────────
// Con efectos, el fondo degradado se pinta dentro de la escena (si no, el
// composer lo dejaría transparente y los efectos harían cosas raras en él).

let texturaFondo = null;

function actualizarFondoEscena() {
  if (fondoActual === 'entorno') {
    escena.background = entornos.get(entornoActual);
  } else if (composer) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(visor.clientWidth / 2));
    c.height = Math.max(2, Math.round(visor.clientHeight / 2));
    pintarFondo(c.getContext('2d'), c.width, c.height);
    texturaFondo?.dispose();
    texturaFondo = new THREE.CanvasTexture(c);
    texturaFondo.colorSpace = THREE.SRGBColorSpace;
    escena.background = texturaFondo;
  } else {
    escena.background = null;
  }
}

function prepararComposer() {
  composer?.dispose();
  composer = null;
  if (efectos.ao || efectos.bloom || efectos.dof) {
    const w = visor.clientWidth, h = visor.clientHeight;
    composer = new EffectComposer(renderer);
    composer.renderTarget1.samples = composer.renderTarget2.samples = 4;
    composer.setSize(w, h);
    composer.addPass(new RenderPass(escena, camara));
    if (efectos.ao) {
      const ao = new GTAOPass(escena, camara, w, h);
      ao.updateGtaoMaterial({ radius: radio * 0.2, distanceExponent: 1, thickness: 1, scale: 1 });
      ao.blendIntensity = 0.9;
      composer.addPass(ao);
    }
    if (efectos.dof) {
      composer.addPass(new BokehPass(escena, camara, {
        focus: camara.position.distanceTo(controles.target),
        aperture: 0.004 / radio,
        maxblur: 0.008,
      }));
    }
    if (efectos.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.5, 0.85));
    composer.addPass(new OutputPass());
  }
  actualizarFondoEscena();
}

for (const boton of document.querySelectorAll('[data-efecto]')) {
  boton.addEventListener('click', () => {
    const nombre = boton.dataset.efecto;
    efectos[nombre] = !efectos[nombre];
    boton.setAttribute('aria-checked', String(efectos[nombre]));
    prepararComposer();
  });
}

// ── Informe: validación glTF y texturas ─────────────────────────

function abrirInforme(pestana) {
  cerrarMenus();
  $('informe').hidden = false;
  for (const b of document.querySelectorAll('[data-pestana]')) {
    const activa = b.dataset.pestana === pestana;
    b.setAttribute('aria-selected', String(activa));
    $('informe-' + b.dataset.pestana).hidden = !activa;
  }
  if (pestana === 'texturas') pintarInformeTexturas();
  $('btn-cerrar-informe').focus();
}
function cerrarInforme() { $('informe').hidden = true; }
for (const b of document.querySelectorAll('[data-pestana]')) b.addEventListener('click', () => abrirInforme(b.dataset.pestana));
$('btn-cerrar-informe').addEventListener('click', cerrarInforme);
$('informe').addEventListener('pointerdown', (e) => { if (e.target === $('informe')) cerrarInforme(); });
$('btn-validacion').addEventListener('click', () => abrirInforme('validacion'));
$('btn-ver-texturas').addEventListener('click', () => abrirInforme('texturas'));

// Validador oficial de Khronos. No es un módulo: es un script (dart2js) que
// se cuelga de una variable global «exports» si existe; se prepara y se carga.
const URL_VALIDADOR = 'https://cdn.jsdelivr.net/npm/gltf-validator@2.0.0-dev.3.10/gltf_validator.dart.js';
let validador = null;
let validacionEnCurso = 0;

function cargarValidador() {
  validador ??= new Promise((ok, mal) => {
    window.exports ??= {};
    const script = document.createElement('script');
    script.src = window.Neutralino ? 'vendor/gltf_validator.dart.js' : URL_VALIDADOR;
    script.onerror = () => mal(new Error('no se ha podido cargar el validador'));
    script.onload = async () => {
      for (let i = 0; i < 40 && !window.exports.validateBytes; i++) await new Promise((r) => setTimeout(r, 50));
      if (window.exports.validateBytes) ok(window.exports);
      else mal(new Error('el validador no ha arrancado'));
    };
    document.head.append(script);
  });
  return validador;
}

const NIVELES = ['Error', 'Aviso', 'Info', 'Pista'];

async function validar(principal) {
  const boton = $('btn-validacion');
  const turno = ++validacionEnCurso;
  if (!['glb', 'gltf'].includes(extension(principal.ruta))) {
    boton.hidden = true;
    $('informe-validacion').innerHTML = '<p class="informe__resumen">La validación es para glTF y GLB.</p>';
    return;
  }
  boton.hidden = false;
  boton.classList.remove('con-errores');
  boton.textContent = 'Validando…';
  try {
    const api = await cargarValidador();
    const informe = await api.validateBytes(new Uint8Array(await principal.blob.arrayBuffer()), {
      maxIssues: 300,
      writeTimestamp: false,
      externalResourceFunction: (uri) => fetch(gestor.resolveURL(decodeURIComponent(uri)))
        .then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    });
    if (turno !== validacionEnCurso) return;
    const { numErrors: errores, numWarnings: avisos } = informe.issues;
    boton.classList.toggle('con-errores', errores > 0);
    boton.textContent = errores || avisos
      ? [errores && `${errores} ${errores === 1 ? 'error' : 'errores'}`, avisos && `${avisos} ${avisos === 1 ? 'aviso' : 'avisos'}`].filter(Boolean).join(' · ')
      : '✓ glTF válido';
    pintarInformeValidacion(informe);
  } catch (error) {
    console.error(error);
    if (turno !== validacionEnCurso) return;
    boton.textContent = 'No se ha podido validar';
    $('informe-validacion').innerHTML = '<p class="informe__resumen">No se ha podido cargar el validador (en la versión web hace falta conexión).</p>';
  }
}

function pintarInformeValidacion(informe) {
  const caja = $('informe-validacion');
  caja.replaceChildren();
  const { numErrors, numWarnings, numInfos, numHints, messages, truncated } = informe.issues;
  const resumen = document.createElement('p');
  resumen.className = 'informe__resumen';
  resumen.innerHTML = `<strong>${numErrors}</strong> errores · <strong>${numWarnings}</strong> avisos · ${numInfos} infos · ${numHints} pistas`
    + (truncated ? ' (lista cortada)' : '') + '<br>Validador oficial de Khronos, versión ' + (informe.validatorVersion || '');
  caja.append(resumen);
  for (const m of messages) {
    const fila = document.createElement('div');
    fila.className = 'problema';
    const nivel = document.createElement('span');
    nivel.className = 'problema__nivel problema__nivel--' + m.severity;
    nivel.textContent = NIVELES[m.severity] || '';
    const texto = document.createElement('span');
    texto.className = 'problema__texto';
    texto.textContent = m.message;
    const donde = document.createElement('span');
    donde.className = 'problema__donde';
    donde.textContent = [m.code, m.pointer].filter(Boolean).join(' · ');
    fila.append(nivel, texto, donde);
    caja.append(fila);
  }
}

// Texturas: tamaño, formato y memoria aproximada en la tarjeta gráfica
const USOS = {
  map: 'Color', normalMap: 'Relieve', roughnessMap: 'Rugosidad', metalnessMap: 'Metal', aoMap: 'Oclusión',
  emissiveMap: 'Emisión', alphaMap: 'Transparencia', bumpMap: 'Relieve', lightMap: 'Luz', specularMap: 'Brillo',
  clearcoatMap: 'Barniz', clearcoatNormalMap: 'Barniz', clearcoatRoughnessMap: 'Barniz', transmissionMap: 'Transmisión',
  sheenColorMap: 'Terciopelo', sheenRoughnessMap: 'Terciopelo', iridescenceMap: 'Iridiscencia', thicknessMap: 'Grosor',
  anisotropyMap: 'Anisotropía', specularColorMap: 'Brillo', specularIntensityMap: 'Brillo',
};

function datosTexturas() {
  if (!modelo) return [];
  const porFuente = new Map();
  modelo.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.userData.materialOriginal ?? o.material)) {
      for (const [clave, t] of Object.entries(m)) {
        if (!t?.isTexture) continue;
        const fuente = t.source ?? t;
        if (!porFuente.has(fuente)) porFuente.set(fuente, { textura: t, usos: new Set() });
        porFuente.get(fuente).usos.add(USOS[clave] || clave);
      }
    }
  });
  return [...porFuente.values()].map(({ textura: t, usos }, i) => {
    let ancho = 0, alto = 0, bytes = 0, formato = 'RGBA 8 bits';
    if (t.isCompressedTexture && t.mipmaps?.length) {
      ancho = t.mipmaps[0].width;
      alto = t.mipmaps[0].height;
      bytes = t.mipmaps.reduce((s, m) => s + (m.data?.byteLength || 0), 0);
      formato = 'Comprimida (GPU)';
    } else {
      const img = t.image;
      ancho = img?.width || img?.videoWidth || 0;
      alto = img?.height || img?.videoHeight || 0;
      bytes = ancho * alto * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1);
    }
    const potencia = (n) => n > 0 && (n & (n - 1)) === 0;
    const avisos = [];
    if (Math.max(ancho, alto) > 4096) avisos.push('Muy grande: más de 4096 px');
    else if (Math.max(ancho, alto) > 2048) avisos.push('Grande: más de 2048 px');
    if (ancho && (!potencia(ancho) || !potencia(alto))) avisos.push('Lado que no es potencia de 2');
    return { textura: t, nombre: t.name || `Textura ${i + 1}`, usos: [...usos], ancho, alto, bytes, formato, avisos };
  }).sort((a, b) => b.bytes - a.bytes);
}

function pintarInformeTexturas() {
  const caja = $('informe-texturas');
  caja.replaceChildren();
  const lista = datosTexturas();
  const total = lista.reduce((s, t) => s + t.bytes, 0);
  const resumen = document.createElement('p');
  resumen.className = 'informe__resumen';
  resumen.innerHTML = lista.length
    ? `<strong>${lista.length}</strong> texturas · unos <strong>${tamano(total)}</strong> en la tarjeta gráfica (aprox., con mipmaps)`
    : 'Este modelo no tiene texturas.';
  caja.append(resumen);
  for (const t of lista) {
    const fila = document.createElement('div');
    fila.className = 'textura';
    const img = t.textura.image;
    let miniatura;
    const dibujable = img && (img instanceof ImageBitmap || img instanceof HTMLImageElement || img instanceof HTMLCanvasElement);
    if (dibujable) {
      miniatura = document.createElement('canvas');
      miniatura.width = miniatura.height = 104;
      try { miniatura.getContext('2d').drawImage(img, 0, 0, 104, 104); } catch { /* sin miniatura */ }
    } else {
      miniatura = document.createElement('span');
      miniatura.className = 'textura__sin';
    }
    const datos = document.createElement('div');
    const nombre = document.createElement('div');
    nombre.className = 'textura__nombre';
    nombre.textContent = t.nombre;
    nombre.title = t.nombre;
    const detalle = document.createElement('div');
    detalle.className = 'textura__datos';
    detalle.textContent = `${t.ancho} × ${t.alto} · ${t.formato} · ${t.usos.join(', ')}`;
    datos.append(nombre, detalle);
    for (const aviso of t.avisos) {
      const a = document.createElement('span');
      a.className = 'textura__aviso';
      a.textContent = aviso;
      datos.append(a);
    }
    const memoria = document.createElement('div');
    memoria.className = 'textura__memoria';
    memoria.textContent = tamano(t.bytes);
    fila.append(miniatura, datos, memoria);
    caja.append(fila);
  }
}

// ── Ayuda: se abre sola la primera vez y luego con «?» o F1 ─────

function abrirAyuda() {
  cerrarMenus();
  $('ayuda').hidden = false;
  $('btn-empezar').focus();
}
function cerrarAyuda() {
  $('ayuda').hidden = true;
  guardarPreferencia('ayuda-vista', '1');
}
$('btn-ayuda').addEventListener('click', abrirAyuda);
$('btn-cerrar-ayuda').addEventListener('click', cerrarAyuda);
$('btn-empezar').addEventListener('click', cerrarAyuda);
$('ayuda').addEventListener('pointerdown', (e) => { if (e.target === $('ayuda')) cerrarAyuda(); });

// La primera vez, salvo que se haya abierto con un archivo (doble clic en
// Windows): entonces lo que se quiere es ver el modelo
async function ayudaPrimeraVez(conArchivo) {
  if (conArchivo || await leerPreferencia('ayuda-vista')) return;
  abrirAyuda();
}

// ── Captura y vídeo ─────────────────────────────────────────────

const DURACION_GIRO = 8; // segundos por vuelta completa
let nombreModelo = 'modelo';

// Lienzo 2D con el fondo y la escena encima, al tamaño real del lienzo 3D
// (redondeado a par: los códecs de vídeo lo piden)
function lienzoCompuesto() {
  const c = document.createElement('canvas');
  c.width = lienzo.width & ~1;
  c.height = lienzo.height & ~1;
  return c;
}
function componer(ctx) {
  const { width: w, height: h } = ctx.canvas;
  pintarFondo(ctx, w, h);
  ctx.drawImage(lienzo, 0, 0, w, h);
}

async function guardarCaptura() {
  if (!modelo || grabacion) return;
  const c = lienzoCompuesto();
  // Se dibuja justo después de renderizar: el búfer 3D aún está lleno
  dibujar();
  componer(c.getContext('2d'));
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  await guardar(blob, `${nombreModelo}.png`, 'Imagen PNG', 'png');
}

const TIPOS_VIDEO = [
  ['video/mp4;codecs=avc1.640028', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm', 'webm'],
];

let grabacion = null;

function grabarVideo() {
  if (!modelo || grabacion || !window.MediaRecorder) return;
  const [tipo, ext] = TIPOS_VIDEO.find(([t]) => MediaRecorder.isTypeSupported(t)) || [];
  if (!tipo) { mostrarAviso('Este navegador no permite grabar vídeo.'); return; }

  const c = lienzoCompuesto();
  const grabador = new MediaRecorder(c.captureStream(60), { mimeType: tipo, videoBitsPerSecond: 16e6 });
  const trozos = [];
  grabador.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };

  viaje = null;
  grabacion = {
    ctx: c.getContext('2d'),
    grabador,
    inicio: null,
    cancelada: false,
    desde: camara.position.clone().sub(controles.target),
  };
  grabador.onstop = async () => {
    const { cancelada, desde } = grabacion;
    camara.position.copy(controles.target).add(desde);
    grabacion = null;
    $('grabando').hidden = true;
    controles.enabled = true;
    ajustarTamano();
    if (!cancelada) await guardar(new Blob(trozos, { type: tipo }), `${nombreModelo}-giro.${ext}`, 'Vídeo', ext);
  };

  controles.enabled = false;
  $('grabando-texto').textContent = 'Grabando giro…';
  $('grabando-progreso').style.width = '0';
  $('grabando').hidden = false;
  grabador.start(250);
}

// Llamado desde el bucle en cada fotograma de la grabación
function avanzarGrabacion(tiempo) {
  const g = grabacion;
  if (g.grabador.state !== 'recording') return;
  g.inicio ??= tiempo;
  const avance = Math.min((tiempo - g.inicio) / 1000 / DURACION_GIRO, 1);
  const giro = new THREE.Vector3().copy(g.desde).applyAxisAngle(THREE.Object3D.DEFAULT_UP, avance * Math.PI * 2);
  camara.position.copy(controles.target).add(giro);
  camara.lookAt(controles.target);
  $('grabando-progreso').style.width = avance * 100 + '%';
  if (avance === 1) {
    $('grabando-texto').textContent = 'Guardando…';
    // Un último fotograma y se cierra
    requestAnimationFrame(() => g.grabador.state === 'recording' && g.grabador.stop());
  }
}

$('btn-cancelar-video').addEventListener('click', () => {
  if (!grabacion) return;
  grabacion.cancelada = true;
  grabacion.grabador.stop();
});

// En el .exe, diálogo «Guardar como» de Windows; en el navegador, descarga
async function guardar(blob, nombre, descripcion, ext) {
  try {
    if (window.Neutralino) {
      let carpeta = '';
      try { carpeta = await Neutralino.os.getPath(ext === 'png' ? 'pictures' : 'video'); } catch { /* sin carpeta */ }
      let ruta = await Neutralino.os.showSaveDialog('Guardar ' + descripcion.toLowerCase(), {
        defaultPath: carpeta ? `${carpeta}\\${nombre}` : nombre,
        filters: [{ name: descripcion, extensions: [ext] }],
      });
      if (!ruta) return;
      if (!ruta.toLowerCase().endsWith('.' + ext)) ruta += '.' + ext;
      await Neutralino.filesystem.writeBinaryFile(ruta, await blob.arrayBuffer());
      mostrarAviso('Guardado en ' + ruta, true);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
  } catch (error) {
    console.error(error);
    mostrarAviso('No se ha podido guardar el archivo.');
  }
}

$('btn-captura').addEventListener('click', guardarCaptura);
$('btn-video').addEventListener('click', grabarVideo);

// ── Abrir: botón, arrastrar y soltar, teclado ───────────────────

const selector = $('selector');
const pedirArchivo = () => (window.Neutralino ? abrirConDialogo() : selector.click());
$('btn-abrir').addEventListener('click', pedirArchivo);
$('btn-vacio').addEventListener('click', pedirArchivo);
selector.addEventListener('change', () => {
  const lista = [...selector.files].map((f) => ({ ruta: f.name, blob: f }));
  selector.value = '';
  if (lista.length) abrir(lista);
});

// Carpetas soltadas: se recorren enteras (glTF con texturas al lado)
async function leerEntrada(entrada, prefijo = '') {
  if (entrada.isFile) {
    const archivo = await new Promise((ok, mal) => entrada.file(ok, mal));
    return [{ ruta: prefijo + archivo.name, blob: archivo }];
  }
  const lector = entrada.createReader();
  const hijos = [];
  for (;;) {
    const tanda = await new Promise((ok, mal) => lector.readEntries(ok, mal));
    if (!tanda.length) break;
    hijos.push(...tanda);
  }
  const resultado = [];
  for (const hijo of hijos) resultado.push(...await leerEntrada(hijo, prefijo + entrada.name + '/'));
  return resultado;
}

let profundidadArrastre = 0;
addEventListener('dragenter', (e) => {
  if (grabacion || !e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  profundidadArrastre++;
  $('soltar').classList.add('visible');
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('dragleave', () => {
  if (--profundidadArrastre <= 0) { profundidadArrastre = 0; $('soltar').classList.remove('visible'); }
});
addEventListener('drop', async (e) => {
  e.preventDefault();
  profundidadArrastre = 0;
  $('soltar').classList.remove('visible');
  if (grabacion) return;
  const entradas = [...(e.dataTransfer?.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  let lista;
  if (entradas.length) {
    lista = [];
    for (const entrada of entradas) lista.push(...await leerEntrada(entrada));
  } else {
    lista = [...(e.dataTransfer?.files || [])].map((f) => ({ ruta: f.name, blob: f }));
  }
  if (lista.length) abrir(lista);
});

addEventListener('keydown', (e) => {
  if (grabacion) { if (e.key === 'Escape') $('btn-cancelar-video').click(); e.preventDefault(); return; }
  if (e.key === 'F1' || e.key === '?') { e.preventDefault(); abrirAyuda(); return; }
  if (e.key === 'Escape') {
    cerrarMenus();
    if (!$('ayuda').hidden) cerrarAyuda();
    else if (!$('informe').hidden) cerrarInforme();
    else if (midiendo) ponerRegla(false);
  }
  if (!$('informe').hidden || !$('ayuda').hidden) return;
  if (e.target.matches?.('input:not([type="range"])') || e.ctrlKey || e.metaKey || e.altKey) return;
  const tecla = e.key.toLowerCase();
  if (tecla === 'o') pedirArchivo();
  else if (tecla === 'f') encuadrar();
  else if (tecla === 'r') cambiarOpcion('girar');
  else if (tecla === 'w') cambiarOpcion('alambre');
  else if (tecla === 'g') cambiarOpcion('rejilla');
  else if (tecla === 'c') guardarCaptura();
  else if (tecla === 'm' && modelo) ponerRegla(!midiendo);
  else if (['1', '2', '3', '4'].includes(tecla)) ponerInspeccion(['materiales', 'matcap', 'uv', 'normales'][+tecla - 1]);
  else if (tecla === 'v') grabarVideo();
  else if (e.key === ' ' && accion) { e.preventDefault(); alternarPausa(); }
});

// ── Mensajes ────────────────────────────────────────────────────

function mostrarCarga(texto) { $('cargando-texto').textContent = texto; $('cargando').hidden = false; }
function ocultarCarga() { $('cargando').hidden = true; }
let temporizadorAviso;
function mostrarAviso(texto, hecho = false) {
  $('aviso').textContent = texto;
  $('aviso').classList.toggle('aviso--hecho', hecho);
  $('aviso').hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(ocultarAviso, 7000);
}
function ocultarAviso() { $('aviso').hidden = true; }

// ── Bucle ───────────────────────────────────────────────────────

function ajustarTamano() {
  if (grabacion) return; // el vídeo mantiene el tamaño con el que empezó
  const { clientWidth: w, clientHeight: h } = visor;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camara.aspect = w / h;
  camara.updateProjectionMatrix();
  if (composer) {
    composer.setSize(w, h);
    actualizarFondoEscena();
  }
}

// Con efectos se dibuja con el composer; sin ellos, directo
function dibujar() {
  if (composer) {
    const bokeh = composer.passes.find((p) => p instanceof BokehPass);
    if (bokeh) bokeh.uniforms.focus.value = camara.position.distanceTo(controles.target);
    composer.render();
  } else {
    renderer.render(escena, camara);
  }
}
new ResizeObserver(ajustarTamano).observe(visor);

const temporizador = new THREE.Timer();
renderer.setAnimationLoop((tiempo) => {
  temporizador.update(tiempo);
  const dt = Math.min(temporizador.getDelta(), 0.1);

  if (viaje) {
    viaje.t = Math.min(viaje.t + dt / 0.6, 1);
    const k = 1 - (1 - viaje.t) ** 3;
    camara.position.lerpVectors(viaje.desdePos, viaje.haciaPos, k);
    controles.target.lerpVectors(viaje.desdeObj, viaje.haciaObj, k);
    if (viaje.t === 1) viaje = null;
  }

  if (mezclador) {
    mezclador.update(dt);
    seguir(dt);
    if (accion && !arrastrandoLinea) {
      const duracion = accion.getClip().duration || 1;
      const t = accion.loop === THREE.LoopRepeat ? accion.time % duracion : Math.min(accion.time, duracion);
      linea.value = t / duracion;
      pintarRelleno(linea);
      $('clip-tiempo').textContent = `${reloj(t)} / ${reloj(duracion)}`;
    }
  }

  if (grabacion) {
    avanzarGrabacion(tiempo);
    dibujar();
    componer(grabacion.ctx);
  } else {
    controles.update(dt);
    dibujar();
  }
  colocarCotas();
});

// ── Versión de escritorio (Neutralino) ──────────────────────────
// Al abrir un archivo con el .exe («Abrir con», o arrastrarlo sobre el icono)
// llega su ruta como argumento. Se lee el archivo y, si no es autocontenido,
// también lo que tiene al lado (texturas, .bin, .mtl…).

const EXT_RECURSO = new Set(['bin', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'ktx2', 'tga', 'bmp', 'gif', 'mtl']);
const LIMITE_VECINOS = 400 * 1024 ** 2;

async function leerRuta(ruta) {
  return new Blob([await Neutralino.filesystem.readBinaryFile(ruta)]);
}

async function vecinos(carpeta, prefijo = '', nivel = 0, cuenta = { bytes: 0 }) {
  const lista = [];
  let entradas = [];
  try { entradas = await Neutralino.filesystem.readDirectory(carpeta); } catch { return lista; }
  for (const e of entradas) {
    if (e.entry === '.' || e.entry === '..') continue;
    const ruta = carpeta + '\\' + e.entry;
    if (e.type === 'DIRECTORY') {
      if (nivel < 2) lista.push(...await vecinos(ruta, prefijo + e.entry + '/', nivel + 1, cuenta));
    } else if (EXT_RECURSO.has(extension(e.entry)) && cuenta.bytes < LIMITE_VECINOS) {
      const blob = await leerRuta(ruta);
      cuenta.bytes += blob.size;
      lista.push({ ruta: prefijo + e.entry, blob });
    }
  }
  return lista;
}

async function abrirDesdeEscritorio(rutas) {
  cerrarMenus();
  mostrarCarga('Leyendo…');
  const lista = [];
  try {
    for (const ruta of rutas) {
      const nombre = ruta.split(/[\\/]/).pop();
      lista.push({ ruta: nombre, blob: await leerRuta(ruta), nombreOriginal: nombre });
      if (['gltf', 'obj', 'fbx', 'dae', 'usda'].includes(extension(nombre))) {
        lista.push(...await vecinos(ruta.replace(/[\\/][^\\/]*$/, '')));
      }
    }
  } catch (error) {
    console.error(error);
    ocultarCarga();
    // Un reciente que ya no está (borrado, movido, en un USB que no está puesto)
    await guardarRecientes((await leerRecientes()).filter((r) => r !== rutas[0]));
    mostrarAviso('No se encuentra ' + rutas[0]);
    return;
  }
  // Se apunta el modelo principal, no las texturas que se hayan elegido con él
  const principal = rutas.find((r) => EXT_MODELO.includes(extension(r)) || extension(r) === 'zip') || rutas[0];
  if (await abrir(lista) === true) apuntarReciente(principal);
}

async function abrirConDialogo() {
  if (grabacion) return;
  const rutas = await Neutralino.os.showOpenDialog('Abrir modelo 3D', {
    multiSelections: true,
    filters: [
      { name: 'Modelos 3D', extensions: ['glb', 'gltf', 'zip', 'fbx', 'obj', 'stl', 'dae', 'usdz', 'usda', 'usdc', 'usd', '3mf', 'ply'] },
      { name: 'Entornos HDRI', extensions: ['hdr', 'exr'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  if (rutas?.length) abrirDesdeEscritorio(rutas);
}

// ── Recientes ───────────────────────────────────────────────────
// Solo en el .exe: hacen falta rutas, y lo que se arrastra a la ventana no la
// trae. Se guardan con el almacenamiento de Neutralino (el localStorage no
// sirve: el puerto, y con él el origen, cambia en cada arranque).

const MAX_RECIENTES = 10;

async function leerRecientes() {
  try { return JSON.parse(await Neutralino.storage.getData('recientes')); } catch { return []; }
}
async function guardarRecientes(rutas) {
  await Neutralino.storage.setData('recientes', JSON.stringify(rutas)).catch(() => {});
  pintarRecientes(rutas);
}
async function apuntarReciente(ruta) {
  const antes = await leerRecientes();
  guardarRecientes([ruta, ...antes.filter((r) => r.toLowerCase() !== ruta.toLowerCase())].slice(0, MAX_RECIENTES));
}

function filaReciente(ruta, conRuta) {
  const li = document.createElement('li');
  li.title = ruta;
  const nombre = document.createElement('span');
  nombre.className = 'lista__nombre';
  nombre.textContent = ruta.split(/[\\/]/).pop();
  if (conRuta) {
    const carpeta = document.createElement('span');
    carpeta.className = 'lista__ruta';
    carpeta.textContent = ruta.replace(/[\\/][^\\/]*$/, '');
    nombre.append(carpeta);
  }
  const ext = document.createElement('span');
  ext.className = 'lista__dato';
  ext.textContent = extension(ruta).toUpperCase();
  li.append(nombre, ext);
  li.addEventListener('click', () => abrirDesdeEscritorio([ruta]));
  return li;
}

function pintarRecientes(rutas) {
  const menu = $('lista-recientes');
  menu.replaceChildren(...rutas.map((r) => filaReciente(r, true)));
  if (!rutas.length) {
    const li = document.createElement('li');
    li.className = 'lista__vacia';
    li.textContent = 'Todavía no hay ninguno';
    menu.append(li);
  }
  const vacio = $('vacio-recientes');
  vacio.replaceChildren(...rutas.slice(0, 5).map((r) => filaReciente(r, false)));
  vacio.hidden = !rutas.length;
}

// ── Menús de la barra ───────────────────────────────────────────

function alternarMenu(boton, menu) {
  const abrirlo = menu.hidden;
  cerrarMenus();
  menu.hidden = !abrirlo;
  boton.setAttribute('aria-expanded', String(abrirlo));
  return abrirlo;
}
function cerrarMenus() {
  for (const [boton, menu] of [['pastilla', 'menu-recientes'], ['btn-ajustes', 'menu-ajustes'], ['btn-clips', 'menu-clips']]) {
    $(menu).hidden = true;
    $(boton).setAttribute('aria-expanded', 'false');
  }
}
addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.desplegable')) cerrarMenus();
});
$('pastilla').addEventListener('click', () => alternarMenu($('pastilla'), $('menu-recientes')));
$('btn-ajustes').addEventListener('click', () => {
  if (alternarMenu($('btn-ajustes'), $('menu-ajustes')) && !$('ajustes-windows').hidden) pintarAsociacion();
});
$('btn-borrar-recientes').addEventListener('click', () => { guardarRecientes([]); cerrarMenus(); });

// ── Asociar los archivos 3D (doble clic en el Explorador) ───────
// Sin instalador: el .exe se copia a %LOCALAPPDATA%\Programs\Visor 3D (para que
// la asociación no se rompa si se mueve o se borra el descargado), se registra
// en HKEY_CURRENT_USER (no pide administrador) y se crea el acceso del menú
// Inicio. Si el usuario ya eligió otra app como predeterminada, Windows la
// respeta: Visor 3D queda en «Abrir con» y la nota explica cómo elegirlo.

const PROGID = 'Visor3D.Modelo';
const EXE = 'Visor-3D.exe';
const EXT_ASOCIADAS = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'dae', 'usdz', '3mf', 'ply'];
const CLASES = 'HKEY_CURRENT_USER\\Software\\Classes';

async function rutasInstalacion() {
  const local = await Neutralino.os.getEnv('LOCALAPPDATA');
  const roaming = await Neutralino.os.getEnv('APPDATA');
  return {
    carpeta: `${local}\\Programs\\Visor 3D`,
    exe: `${local}\\Programs\\Visor 3D\\${EXE}`,
    acceso: `${roaming}\\Microsoft\\Windows\\Start Menu\\Programs\\Visor 3D.lnk`,
  };
}

function rutaEjecutable() {
  const ruta = (window.NL_ARGS || [])[0] || '';
  return /^([a-z]:|\\\\)/i.test(ruta) ? ruta : `${window.NL_CWD}\\${ruta}`;
}

const ejecutar = (orden) => Neutralino.os.execCommand(orden);

async function estaAsociado() {
  const r = await ejecutar(`reg query "${CLASES}\\${PROGID}\\shell\\open\\command" /ve`);
  return r.exitCode === 0;
}

// Los .reg van en UTF-16 con BOM: así aguantan rutas con tildes o eñes
async function importarReg(lineas) {
  const texto = ['Windows Registry Editor Version 5.00', '', ...lineas, ''].join('\r\n');
  const datos = new Uint8Array(2 + texto.length * 2);
  datos[0] = 0xff; datos[1] = 0xfe;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    datos[2 + i * 2] = c & 0xff;
    datos[3 + i * 2] = c >> 8;
  }
  const temporal = `${await Neutralino.os.getPath('temp')}\\visor-3d-registro.reg`;
  await Neutralino.filesystem.writeBinaryFile(temporal, datos.buffer);
  const r = await ejecutar(`reg import "${temporal}"`);
  await Neutralino.filesystem.remove(temporal).catch(() => {});
  if (r.exitCode !== 0) throw new Error(r.stdErr || 'reg import ha fallado');
}

const cadenaReg = (texto) => '"' + texto.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

async function asociar() {
  const destino = await rutasInstalacion();
  const origen = rutaEjecutable();
  if (origen.toLowerCase() !== destino.exe.toLowerCase()) {
    await Neutralino.filesystem.createDirectory(destino.carpeta).catch(() => {});
    await Neutralino.filesystem.remove(destino.exe).catch(() => {});
    try {
      await Neutralino.filesystem.copy(origen, destino.exe);
    } catch (error) {
      // Si hay otra ventana abierta desde la copia instalada no se puede
      // sustituir, pero la que hay sirve igual
      const existe = await Neutralino.filesystem.getStats(destino.exe).then(() => true, () => false);
      if (!existe) throw error;
    }
  }

  const orden = cadenaReg(`"${destino.exe}" "%1"`);
  const lineas = [
    `[${CLASES}\\${PROGID}]`,
    '@="Modelo 3D"',
    `[${CLASES}\\${PROGID}\\DefaultIcon]`,
    `@=${cadenaReg(`"${destino.exe}",0`)}`,
    `[${CLASES}\\${PROGID}\\shell\\open\\command]`,
    `@=${orden}`,
    `[${CLASES}\\Applications\\${EXE}]`,
    '"FriendlyAppName"="Visor 3D"',
    `[${CLASES}\\Applications\\${EXE}\\shell\\open\\command]`,
    `@=${orden}`,
    `[${CLASES}\\Applications\\${EXE}\\SupportedTypes]`,
    ...EXT_ASOCIADAS.map((ext) => `".${ext}"=""`),
  ];
  for (const ext of EXT_ASOCIADAS) {
    lineas.push(`[${CLASES}\\.${ext}]`, `@="${PROGID}"`, `[${CLASES}\\.${ext}\\OpenWithProgids]`, `"${PROGID}"=hex(0):`);
  }
  await importarReg(lineas);

  // Acceso en el menú Inicio
  const comillas = (t) => "'" + t.replace(/'/g, "''") + "'";
  await ejecutar(`powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${comillas(destino.acceso)}); $s.TargetPath=${comillas(destino.exe)}; $s.Save()"`);

  // Que el Explorador vuelva a leer iconos y asociaciones
  await ejecutar('ie4uinit.exe -show').catch(() => {});
}

async function desasociar() {
  const destino = await rutasInstalacion();
  const lineas = [`[-${CLASES}\\${PROGID}]`, `[-${CLASES}\\Applications\\${EXE}]`];
  for (const ext of EXT_ASOCIADAS) lineas.push(`[${CLASES}\\.${ext}\\OpenWithProgids]`, `"${PROGID}"=-`);
  await importarReg(lineas);
  // La predeterminada solo se quita si es la nuestra
  for (const ext of EXT_ASOCIADAS) {
    const r = await ejecutar(`reg query "${CLASES}\\.${ext}" /ve`);
    if (r.stdOut.includes(PROGID)) await ejecutar(`reg delete "${CLASES}\\.${ext}" /ve /f`);
  }
  await Neutralino.filesystem.remove(destino.acceso).catch(() => {});
  // La copia instalada se borra si no es la que está abierta ahora
  if (rutaEjecutable().toLowerCase() !== destino.exe.toLowerCase()) {
    await Neutralino.filesystem.remove(destino.exe).catch(() => {});
    await Neutralino.filesystem.remove(destino.carpeta).catch(() => {});
  }
  await ejecutar('ie4uinit.exe -show').catch(() => {});
}

async function pintarAsociacion(asociado) {
  asociado ??= await estaAsociado().catch(() => false);
  const estado = $('estado-asociacion');
  estado.textContent = asociado ? 'Activado' : 'Desactivado';
  estado.classList.toggle('activo', asociado);
  const boton = $('btn-asociar');
  boton.textContent = asociado ? 'Quitar' : 'Asociar';
  boton.classList.toggle('quitar', asociado);
}

$('btn-asociar').addEventListener('click', async () => {
  const boton = $('btn-asociar');
  const quitar = boton.classList.contains('quitar');
  boton.disabled = true;
  try {
    if (quitar) await desasociar();
    else await asociar();
    $('nota-asociacion').hidden = quitar;
    await pintarAsociacion();
  } catch (error) {
    console.error(error);
    mostrarAviso(quitar ? 'No se ha podido quitar la asociación.' : 'No se han podido asociar los archivos.');
  } finally {
    boton.disabled = false;
  }
});

if (window.Neutralino) {
  Neutralino.init();
  document.documentElement.classList.add('es-exe');
  $('pastilla').disabled = false;
  $('ajustes-recientes').hidden = false;
  $('ajustes-windows').hidden = window.NL_OS !== 'Windows'; // registro y menú Inicio: solo Windows
  leerRecientes().then(pintarRecientes);
  const rutas = (window.NL_ARGS || []).slice(1).filter((a) => !a.startsWith('--'));
  if (rutas.length) abrirDesdeEscritorio(rutas);
}

iniciarTema();
ayudaPrimeraVez((window.NL_ARGS || []).slice(1).some((a) => !a.startsWith('--')));
