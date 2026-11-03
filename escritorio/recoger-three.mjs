// Copia de three solo lo que usa main.js (y lo que eso importa a su vez),
// más los decodificadores Draco y Basis, para que el .exe funcione sin red.
// Uso: node recoger-three.mjs <paquete three> <main.js> <destino>
import fs from 'node:fs';
import path from 'node:path';

const [paquete, principal, destino] = process.argv.slice(2);
const importaciones = (codigo) => [...codigo.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)]
  .map((m) => m[1] || m[2]);

const pendientes = [];
for (const spec of importaciones(fs.readFileSync(principal, 'utf8'))) {
  if (spec === 'three') pendientes.push('build/three.module.js');
  else if (spec.startsWith('three/addons/')) pendientes.push('examples/jsm/' + spec.slice('three/addons/'.length));
}

const vistos = new Set();
while (pendientes.length) {
  const rel = pendientes.pop();
  if (vistos.has(rel)) continue;
  vistos.add(rel);
  const codigo = fs.readFileSync(path.join(paquete, rel), 'utf8');
  for (const spec of importaciones(codigo)) {
    if (spec === 'three') pendientes.push('build/three.module.js');
    else if (spec.startsWith('three/addons/')) pendientes.push('examples/jsm/' + spec.slice('three/addons/'.length));
    else if (spec.startsWith('.')) pendientes.push(path.posix.join(path.posix.dirname(rel), spec));
    else throw new Error(`importación inesperada en ${rel}: ${spec}`);
  }
}

const copiar = (rel) => {
  const salida = path.join(destino, rel.replace(/^examples\/jsm\//, 'addons/'));
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.copyFileSync(path.join(paquete, rel), salida);
};
vistos.forEach(copiar);
for (const carpeta of ['examples/jsm/libs/draco/gltf', 'examples/jsm/libs/basis']) {
  for (const f of fs.readdirSync(path.join(paquete, carpeta))) copiar(`${carpeta}/${f}`);
}
console.log(`three: ${vistos.size} módulos + decodificadores`);
