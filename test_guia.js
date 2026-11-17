const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
class Elemento {
  constructor() { this.children = {}; this.style = {}; this.dataset = {}; this.open = false; this.offsetWidth = 200; this.offsetHeight = 100; }
  setAttribute() {}
  append() {}
  querySelector(selector) { return this.children[selector] ||= new Elemento(); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  addEventListener() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 20, right: 100, top: 20, bottom: 60 }; }
  getClientRects() { return [1]; }
}
const app = new Elemento(), boton = new Elemento(), destino = new Elemento();
const dialogos = [];
const document = { body: { dataset: { vista: "resumen" } },
  createElement() { const e = new Elemento(); dialogos.push(e); return e; },
  querySelector(s) { return s === ".app" ? app : destino; } };
const ctx = { document, window: { addEventListener() {} }, innerWidth: 800, innerHeight: 600,
  estado: { guiaVista: true, guiaVistas: {} }, ia: { configurada: false },
  guardar() {}, irAVista(v) { document.body.dataset.vista = v; ctx.mostrar(v); },
  $(id) { return id === "btnGuia" ? boton : new Elemento(); } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("static/guia.js", "utf8") + "\nthis.mostrar = mostrarGuiaVista; iniciarGuia(); this.mostrar = mostrarGuiaVista;", ctx);
const [recorrido, intro, ayuda] = dialogos;
assert.equal(intro.open, true);
assert.deepEqual(Object.keys(ctx.estado.guiaVistas), ["resumen"]);
intro.querySelector(".guia-intro-siguiente").onclick();
assert.equal(recorrido.open, true);
assert.equal(recorrido.querySelector(".guia-siguiente").textContent, "Siguiente");
recorrido.querySelector(".guia-siguiente").onclick();
assert.equal(recorrido.querySelector(".guia-siguiente").textContent, "Terminar");
recorrido.querySelector(".guia-siguiente").onclick();
assert.equal(document.body.dataset.vista, "resumen");
ctx.irAVista("fijos");
assert.equal(intro.open, true);
assert.deepEqual(Object.keys(ctx.estado.guiaVistas), ["resumen", "fijos"]);
intro.querySelector(".guia-intro-siguiente").onclick();
assert.equal(recorrido.querySelector(".guia-siguiente").textContent, "Siguiente");
recorrido.querySelector(".guia-siguiente").onclick();
assert.equal(recorrido.querySelector(".guia-siguiente").textContent, "Terminar");
recorrido.querySelector(".guia-siguiente").onclick();
ctx.irAVista("fijos");
assert.equal(intro.open, false);
boton.onclick();
assert.equal(intro.querySelector(".guia-intro-visual").dataset.guiaVisual, "fijos");
intro.querySelector(".guia-intro-salir").onclick();
console.log("Guías por vista: OK");
