const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Elemento {
  constructor() { this.children = []; this.value = ""; this.textContent = ""; this._html = ""; }
  set innerHTML(valor) { this._html = valor; this.children = []; }
  get innerHTML() { return this._html; }
  append(...elementos) { this.children.push(...elementos); }
  add(elemento) { this.children.push(elemento); }
  setAttribute() {}
  scrollIntoView() {}
}
const nodos = {};
const $ = id => nodos[id] ||= new Elemento();
const estado = { movimientos: [], compras: [], prestamos: [], ahorros: [], tarjeta: null };
let guardado = JSON.stringify(estado), id = 0;
const propuesta = { tipo: "gasto", concepto: "Café ficticio", categoria: "Otros", monto: 12000,
  fecha: "2026-11-01", cuotas: null, persona: null, ahorro: null, fecha_acordada: null };
const entorno = { document: { createElement: () => new Elemento(), querySelectorAll: () => [] },
  Option: function (texto, valor) { this.text = texto; this.value = valor; }, $, estado,
  CATEGORIAS: ["Otros"], ORIGENES: ["Otros"], uid: () => String(++id),
  hoy: () => "2026-11-01", render: () => {}, guardar: () => { guardado = JSON.stringify(estado); },
  propuesta };
vm.createContext(entorno);
vm.runInContext(fs.readFileSync("static/asistente.js", "utf8"), entorno);
const proponer = () => vm.runInContext('ejecutarHerramienta("proponer_movimientos", {items: [propuesta], nota: null})', entorno);
const botones = () => $("iaPropuestas").children[0].children.at(-1).children;

assert.match(proponer().estado, /todavía no/);
assert.equal(estado.movimientos.length, 0);
assert.equal(JSON.parse(guardado).movimientos.length, 0);
assert.match(proponer().error, /pendientes/);
botones()[1].onclick();
assert.equal(estado.movimientos.length, 0);
proponer();
botones()[0].onclick();
assert.equal(JSON.parse(guardado).movimientos[0].monto, 12000);
entorno.propuesta = { ...propuesta, monto: -100 };
proponer();
botones()[0].onclick();
assert.equal(estado.movimientos.length, 1);
assert.match($("iaEstado").textContent, /no se pudieron/);
console.log("Propuestas del chat: pruebas correctas");
entorno.esc = texto => texto;
vm.runInContext('contextoAyuda = ["ayuda", "Gastos", "Descripción"]; consultarChat = async () => { historialChat.push({type: "function_call"}); throw new Error("sin conexión"); }', entorno);
(async () => {
  await vm.runInContext('preguntar("Pregunta ficticia")', entorno);
  assert.equal(vm.runInContext('historialChat.length', entorno), 0);
  assert.equal($("chatTexto").value, "Pregunta ficticia");
  assert.equal(vm.runInContext('contextoAyuda[1]', entorno), "Gastos");
  console.log("Reintento del chat: prueba correcta");
})().catch(error => { console.error(error); process.exitCode = 1; });
