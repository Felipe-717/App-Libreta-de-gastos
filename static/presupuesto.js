"use strict";

/*
 * Presupuesto por categoría: un tope mensual que rige todos los meses. Se mide
 * contra el consumo del mes (lo anotado, los fijos pagados y lo comprado con
 * tarjeta), y en el mes en curso también contra el ritmo: a la velocidad que va,
 * cuánto llevaría al cerrar el mes.
 */

let editandoTopes = false;

function normalizarPresupuestos(p) {
  const salida = {};
  for (const [k, v] of Object.entries(p || {})) if (Number(v) > 0) salida[k] = Math.round(Number(v));
  return salida;
}

/** Fracción del mes ya corrida: 1 para meses cerrados, 0 para los que no han empezado. */
function avanceDelMes(m) {
  const actual = mesDe(hoy());
  if (m < actual) return 1;
  if (m > actual) return 0;
  const dias = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  return Number(hoy().slice(8, 10)) / dias;
}

/** Cómo va cada categoría con tope: gastado, al ritmo actual y su estado. */
function estadoPresupuesto(m) {
  const consumo = Object.fromEntries(consumoPorCategoria(m).pares);
  const avance = avanceDelMes(m);
  return Object.entries(estado.presupuestos).map(([cat, tope]) => {
    const gastado = consumo[cat] || 0;
    // El ritmo solo tiene sentido pasada la primera semana; antes cualquier gasto lo dispara.
    const ritmo = avance >= 0.25 && avance < 1 ? Math.round(gastado / avance) : gastado;
    const clave = gastado > tope ? "pasado" : (ritmo > tope * 1.05 || gastado >= tope * 0.85) ? "cuidado" : "bien";
    return { cat, tope, gastado, ritmo, clave, pct: gastado / tope };
  }).sort((a, b) => b.pct - a.pct);
}

/** Lo que suele gastar por categoría: promedio de los últimos tres meses con registros. */
function promedioCategoria(cat) {
  const previos = mesesRegistrados().filter(x => x < mesDe(hoy())).slice(-3);
  if (!previos.length) return 0;
  return Math.round(previos.reduce((s, m) =>
    s + (Object.fromEntries(consumoPorCategoria(m).pares)[cat] || 0), 0) / previos.length);
}

function renderPresupuesto() {
  const cont = $("listaPresupuesto");
  cont.innerHTML = "";
  $("btnTopes").textContent = editandoTopes ? "Cancelar" : Object.keys(estado.presupuestos).length ? "Editar topes" : "Definir topes";
  if (editandoTopes) { cont.append(formularioTopes()); $("presupuestoResumen").textContent = ""; return; }

  const filas = estadoPresupuesto(mes);
  if (!filas.length) {
    cont.innerHTML = '<div class="vacio">Sin topes. Póngale un límite mensual a las categorías que quiera cuidar y aquí verá cómo va.</div>';
    $("presupuestoResumen").textContent = "";
    return;
  }

  const enCurso = mes === mesDe(hoy());
  filas.forEach(f => {
    const fila = document.createElement("div");
    fila.className = "tope " + f.clave;
    fila.innerHTML = '<span class="tope-cat"><i></i><b></b></span><div class="tope-barra"><i></i><u></u></div><span class="tope-cifra"></span><small></small>';
    fila.querySelector(".tope-cat i").style.background = colorCat(f.cat);
    fila.querySelector(".tope-cat b").textContent = f.cat;
    fila.querySelector(".tope-barra i").style.width = Math.min(100, 100 * f.pct) + "%";
    // La marca del ritmo dice hasta dónde llegaría al cierre si sigue igual.
    const marca = fila.querySelector(".tope-barra u");
    marca.hidden = !enCurso || f.ritmo === f.gastado;
    marca.style.left = Math.min(100, 100 * f.ritmo / f.tope) + "%";
    fila.querySelector(".tope-cifra").textContent = cop(f.gastado) + " de " + cop(f.tope);
    fila.querySelector("small").textContent = f.gastado > f.tope
      ? "se pasó " + cop(f.gastado - f.tope)
      : enCurso && f.ritmo > f.tope ? "a este ritmo cierra en " + cop(f.ritmo)
      : "le quedan " + cop(f.tope - f.gastado);
    cont.append(fila);
  });

  const total = filas.reduce((s, f) => s + f.tope, 0), usado = filas.reduce((s, f) => s + f.gastado, 0);
  $("presupuestoResumen").textContent = cop(usado) + " de " + cop(total);
}

function formularioTopes() {
  const caja = document.createElement("div");
  caja.className = "edicion";
  const rejilla = document.createElement("div");
  rejilla.className = "edicion-campos";
  const entradas = {};
  CATEGORIAS.forEach(cat => {
    const d = document.createElement("div");
    const promedio = promedioCategoria(cat);
    d.innerHTML = "<label></label><input type='number' min='0' step='10000'>";
    d.querySelector("label").textContent = cat;
    const i = d.querySelector("input");
    i.value = estado.presupuestos[cat] || "";
    i.placeholder = promedio ? "suele " + Math.round(promedio / 1000) + " mil" : "sin tope";
    entradas[cat] = i;
    rejilla.append(d);
  });
  const botones = document.createElement("div");
  botones.className = "edicion-botones";
  const ok = document.createElement("button");
  ok.className = "primario";
  ok.textContent = "Guardar topes";
  ok.onclick = () => {
    estado.presupuestos = normalizarPresupuestos(Object.fromEntries(
      Object.entries(entradas).map(([k, i]) => [k, i.value])));
    editandoTopes = false;
    render(); guardar();
  };
  const nota = document.createElement("span");
  nota.className = "nota";
  nota.textContent = "Deje en blanco las categorías sin tope. El gris es lo que suele gastar, en promedio de los últimos meses.";
  botones.append(ok, nota);
  caja.append(rejilla, botones);
  return caja;
}

function iniciarPresupuesto() {
  $("btnTopes").onclick = () => { editandoTopes = !editandoTopes; renderPresupuesto(); };
}
