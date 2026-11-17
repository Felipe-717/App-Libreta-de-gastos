"use strict";

/*
 * Para revisar: lo que conviene mirar hoy, calculado con reglas sobre los datos
 * (sin IA). Pagos que vencen o se atrasaron, préstamos vencidos, topes pasados,
 * fijos que subieron y gastos que se repiten cada mes sin estar como fijos.
 * Lo más urgente también sale como notificación de Windows, una vez al día.
 */

const DESCARTADOS = "avisosDescartados";

function descartados() {
  try { return JSON.parse(localStorage.getItem(DESCARTADOS) || "[]"); } catch (e) { return []; }
}
function descartar(clave) {
  try { localStorage.setItem(DESCARTADOS, JSON.stringify([...descartados(), clave].slice(-200))); } catch (e) { /* idem */ }
}

/** Concepto comparable: sin tildes, números ni mayúsculas. "Almuerzo 2" = "almuerzo". */
const raiz = t => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[0-9]+/g, "").replace(/[^a-zñ ]/g, " ").replace(/\s+/g, " ").trim();

function calcularAvisos() {
  const avisos = [];
  const hoyF = hoy(), actual = mesDe(hoyF), dia = Number(hoyF.slice(8, 10));

  // Tarjeta: el extracto que ya cortó y falta pagar, si vence pronto o ya venció.
  const ex = extractoDeHoy();
  if (ex && ex.d.total && !ex.d.pago && ex.estado !== "en curso") {
    const faltan = diasEntre(fechaDePago(ex.mes), hoyF);
    if (faltan <= 5) avisos.push({
      clave: "tarjeta:" + ex.mes, nivel: faltan < 0 ? "alerta" : "atencion", pago: true, ir: "tarjeta",
      titulo: faltan < 0 ? "El pago de la tarjeta está vencido" : faltan === 0 ? "Hoy se paga la tarjeta" : "La tarjeta se paga en " + faltan + (faltan === 1 ? " día" : " días"),
      detalle: cop(ex.d.total) + " del extracto que cortó el " + diaCorto(corteDe(ex.mes)) + ", vence el " + diaCorto(fechaDePago(ex.mes)) + "."
    });
  }

  // Fijos: los que ya suelen estar pagos a esta altura, y los que tocan en tres días.
  estado.fijos.filter(f => enVigencia(f, actual) && !f.pagado[actual]).forEach(f => {
    const d = diaHabitual(f);
    if (!d) return;
    const faltan = d - dia;
    if (faltan < 0) avisos.push({ clave: "fijo:" + f.id + ":" + actual, nivel: "atencion", pago: true, ir: "fijos",
      titulo: f.concepto + " sin marcar", detalle: "Suele pagarse el " + d + " y no está marcado este mes (" + cop(montoVigente(f, actual)) + ")." });
    else if (faltan <= 3) avisos.push({ clave: "fijo:" + f.id + ":" + actual, nivel: "info", pago: true, ir: "fijos",
      titulo: f.concepto + (faltan === 0 ? " se paga hoy" : " se paga en " + faltan + (faltan === 1 ? " día" : " días")),
      detalle: cop(montoVigente(f, actual)) + ", según cuándo lo pagó la última vez." });
  });

  // Préstamos vencidos o por vencer.
  estado.prestamos.forEach(p => {
    const e = estadoPrestamo(p);
    if (e.clave === "vencido") avisos.push({ clave: "prestamo:" + p.id, nivel: "atencion", pago: true, ir: "prestamos",
      titulo: p.persona + " le debe " + cop(e.pendiente), detalle: e.texto + (p.concepto ? " · " + p.concepto : "") + "." });
    else if (e.clave === "pronto") avisos.push({ clave: "prestamo:" + p.id, nivel: "info", ir: "prestamos",
      titulo: p.persona + " le paga pronto", detalle: e.texto + ": " + cop(e.pendiente) + "." });
  });

  // Presupuesto: topes pasados o en camino de pasarse.
  estadoPresupuesto(actual).filter(f => f.clave !== "bien").forEach(f => avisos.push({
    clave: "tope:" + f.cat + ":" + actual, nivel: f.clave === "pasado" ? "alerta" : "atencion",
    titulo: f.clave === "pasado" ? f.cat + ": se pasó del tope" : f.cat + ": cerca del tope",
    detalle: cop(f.gastado) + " de " + cop(f.tope) + (f.clave !== "pasado" && f.ritmo > f.tope ? "; a este ritmo cierra en " + cop(f.ritmo) : "") + "."
  }));

  // Fijos que subieron en los últimos dos meses.
  estado.fijos.filter(f => enVigencia(f, actual)).forEach(f => {
    [actual, mesAnterior(actual)].forEach(m => {
      if (f.montos[m] === undefined) return;
      const antes = montoVigente(f, mesAnterior(m)), ahora = f.montos[m];
      if (ahora > antes) avisos.push({ clave: "alza:" + f.id + ":" + m, nivel: "info", sugerencia: true, ir: "fijos",
        titulo: f.concepto + " subió " + Math.round(100 * (ahora - antes) / antes) + "%",
        detalle: "Pasó de " + cop(antes) + " a " + cop(ahora) + " desde " + nombreMes(m).toLowerCase() + ": " + cop(12 * (ahora - antes)) + " más al año." });
    });
  });

  // Gastos que se repiten en distintos meses con montos parecidos y no están como fijos.
  const fijos = new Set(estado.fijos.map(f => raiz(f.concepto)));
  const meses = mesesRegistrados().filter(m => m <= actual).slice(-3);
  const grupos = {};
  [...estado.movimientos.filter(x => x.tipo === "gasto"), ...estado.compras.filter(x => x.tipo === "compra")]
    .filter(x => meses.includes(mesDe(x.fecha)))
    .forEach(x => {
      const r = raiz(x.concepto);
      if (r.length < 3 || fijos.has(r)) return;
      (grupos[r] = grupos[r] || []).push(x);
    });
  Object.entries(grupos).forEach(([r, lista]) => {
    const enMeses = new Set(lista.map(x => mesDe(x.fecha)));
    if (enMeses.size < 2) return;
    const montos = lista.map(x => x.monto), prom = montos.reduce((s, v) => s + v, 0) / montos.length;
    // Solo cuenta si es más o menos lo mismo cada vez: así "almuerzo" no salta, "Netflix" sí.
    if (montos.some(v => Math.abs(v - prom) > prom * 0.2) || lista.length > enMeses.size + 1) return;
    const ejemplo = lista[lista.length - 1];
    avisos.push({ clave: "repetido:" + r, nivel: "info", sugerencia: true,
      titulo: "¿" + (ejemplo.concepto || r) + " es un fijo?",
      detalle: "Aparece en " + enMeses.size + " meses por unos " + cop(Math.round(prom)) + ". Como fijo, sale en lo que viene y en la proyección.",
      accion: { texto: "Volverlo fijo", fn: () => {
        estado.fijos.push({ id: uid(), concepto: ejemplo.concepto || r, categoria: ejemplo.categoria || "Otros",
                            monto: Math.round(prom), montos: {}, desde: mesSiguiente(actual), hasta: null, pagado: {} });
        render(); guardar();
      } } });
  });

  const fuera = new Set(descartados());
  const orden = { alerta: 0, atencion: 1, info: 2 };
  return avisos.filter(a => !fuera.has(a.clave)).sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

function renderRevisar() {
  const avisos = calcularAvisos();
  const panel = $("panelRevisar");
  panel.hidden = !avisos.length;
  $("revisarResumen").textContent = avisos.length ? avisos.length + (avisos.length === 1 ? " cosa" : " cosas") : "";
  const cont = $("listaRevisar");
  cont.innerHTML = "";
  avisos.slice(0, 8).forEach(a => {
    const d = document.createElement("div");
    d.className = "aviso-item " + a.nivel;
    d.innerHTML = "<div class='txt'><b></b><small></small></div>";
    d.querySelector("b").textContent = a.titulo;
    d.querySelector("small").textContent = a.detalle;
    if (a.accion) {
      const b = document.createElement("button");
      b.textContent = a.accion.texto;
      b.onclick = () => { descartar(a.clave); a.accion.fn(); };
      d.append(b);
    } else if (a.ir) {
      const b = document.createElement("button");
      b.className = "ghost";
      b.textContent = "Ver";
      b.onclick = () => irAVista(a.ir);
      d.append(b);
    }
    const x = document.createElement("button");
    x.className = "ghost";
    x.textContent = "×";
    x.title = "Ya lo vi, no mostrar más";
    x.onclick = () => { descartar(a.clave); renderRevisar(); };
    d.append(x);
    cont.append(d);
  });
}

/** Una notificación de Windows al día con los pagos que piden atención. */
async function notificarPendientes() {
  const urgentes = calcularAvisos().filter(a => a.pago && a.nivel !== "info");
  const proximos = calcularAvisos().filter(a => a.pago && a.nivel === "info");
  const lista = [...urgentes, ...proximos];
  if (!lista.length) return;
  const llave = "notificado:" + hoy();
  try { if (localStorage.getItem(llave)) return; } catch (e) { return; }
  try {
    const r = await fetch("/api/notificar", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Libreta-Sesion": contextoSesion },
      body: JSON.stringify({
        titulo: lista.length === 1 ? lista[0].titulo : lista.length + " pagos para revisar",
        texto: lista.slice(0, 3).map(a => a.titulo).join(" · ")
      })
    });
    if (r.ok) localStorage.setItem(llave, "1");
  } catch (e) { /* sin notificación no pasa nada: el panel sigue ahí */ }
}
