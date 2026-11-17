const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const elementos = { chatTexto: { value: "borrador" }, btnChat: {}, chat: { append() {}, children: [] }, chatBienvenida: {} };
const ctx = { $(id) { return elementos[id]; }, document: { createElement() { return {}; } }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("static/asistente.js", "utf8") + `
  burbuja = () => ({}); esc = s => s; markdown = s => s;
  enlazarArchivos = s => s; pintarExtras = () => {};
  consultarChat = async () => { capturas.push(JSON.parse(JSON.stringify(historialChat))); return { output: [] }; };
  contextoAyuda = ["fijos", "Fijos y sueldo", "Saldo inicial es el dinero que tenía al comenzar el mes."];
  this.probar = async () => {
    await preguntar("¿Qué significa saldo inicial?");
    await preguntar("¿Y la frecuencia?");
    contextoAyuda = ["tarjeta", "Tarjeta", "Cupo es el límite de crédito."];
    nuevaConversacion();
    await preguntar("Otra pregunta");
  };`, Object.assign(ctx, { capturas: [] }));
ctx.probar().then(() => {
  assert.match(ctx.capturas[0][0].content, /Contexto de la sección Fijos y sueldo/);
  assert.match(ctx.capturas[0][0].content, /Pregunta del usuario: ¿Qué significa saldo inicial\?/);
  assert.equal(ctx.capturas[1][1].content, "¿Y la frecuencia?");
  assert.equal(ctx.capturas[2][0].content, "Otra pregunta");
  console.log("Contexto del chat: OK");
}).catch(e => { console.error(e); process.exitCode = 1; });
