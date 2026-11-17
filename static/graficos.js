"use strict";

/*
 * Gráficos del resumen, dibujados a mano en SVG: no dependen de internet ni de
 * librerías. Los colores salen de las variables de styles.css, así que el modo
 * oscuro llega solo. La paleta categórica está validada para daltonismo.
 */

const NS = "http://www.w3.org/2000/svg";
const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7"];

// El color sigue a la categoría, nunca a su puesto: así no cambia de un mes a otro.
const COLOR_CATEGORIA = {
  "Vivienda": "--s1", "Alimentación": "--s2", "Transporte": "--s3", "Ocio": "--s4",
  "Salud": "--s5", "Suscripciones": "--s6", "Servicios": "--s7"
};
const colorCat = k => "var(" + (COLOR_CATEGORIA[k] || "--s-otro") + ")";

const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function el(nombre, attrs, padre) {
  const n = document.createElementNS(NS, nombre);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  if (padre) padre.append(n);
  return n;
}

/** $1,2 M · $350 mil · $9.000: cifras cortas para ejes y etiquetas. */
function copCorto(n) {
  const a = Math.abs(n), s = n < 0 ? "−$" : "$";
  if (a >= 1e6) return s + (a / 1e6).toLocaleString("es-CO", { maximumFractionDigits: a >= 1e7 ? 0 : 1 }) + " M";
  if (a >= 1e3) return s + Math.round(a / 1e3).toLocaleString("es-CO") + " mil";
  return s + Math.round(a);
}

const mesCorto = m => {
  const t = new Date(m + "-01T12:00").toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
  return t.charAt(0).toUpperCase() + t.slice(1) + (m.endsWith("-01") ? " " + m.slice(2, 4) : "");
};

/* ---------------------------------------------------------------- tooltip */
function mostrarTip(html, ev) {
  const t = $("tooltip");
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  t.style.left = Math.max(8, x) + "px";
  t.style.top = Math.max(8, y) + "px";
}
const ocultarTip = () => { $("tooltip").hidden = true; };
const filaTip = (color, etiqueta, valor) =>
  `<div class="t-fila"><span>${color ? `<i style="background:${color}"></i> ` : ""}${esc(etiqueta)}</span><b>${esc(valor)}</b></div>`;

/** Marcas redondas y limpias para el eje: 0, 500 mil, 1 M... */
function escalaY(min, max, pasos) {
  const rango = Math.max(max - min, 1);
  const bruto = rango / pasos;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map(f => f * mag).find(p => p >= bruto);
  const lo = Math.floor(min / paso) * paso, hi = Math.ceil(max / paso) * paso;
  const marcas = [];
  for (let v = lo; v <= hi + paso / 2; v += paso) marcas.push(v);
  return { lo, hi, marcas };
}

/* ------------------------------------------------------- saldo mes a mes */
function graficoSaldo() {
  const cont = $("grafSaldo");
  cont.innerHTML = "";
  const actual = mesDe(hoy());
  const reales = mesesRegistrados().filter(m => m <= actual).slice(-12)
    .map(m => ({ mes: m, saldo: resumenMes(m).saldo }));
  const proy = proyectarSaldo(6);
  if (!reales.length) { cont.innerHTML = '<div class="vacio">Aún no hay meses para graficar.</div>'; return; }

  // La proyección arranca donde termina lo real, para que la línea no se corte.
  const ultimo = reales[reales.length - 1];
  const puntosProy = [{ mes: ultimo.mes, saldo: proy.base, puente: true }, ...proy.meses];
  const todos = [...reales.map(p => p.mes), ...proy.meses.map(p => p.mes)];

  const W = Math.max(cont.clientWidth, 320), H = 230;
  const m = { t: 14, r: 16, b: 26, l: 62 };
  const valores = [...reales.map(p => p.saldo), ...puntosProy.map(p => p.saldo), 0];
  const { lo, hi, marcas } = escalaY(Math.min(...valores), Math.max(...valores), 4);
  const x = i => m.l + (todos.length === 1 ? (W - m.l - m.r) / 2 : i * (W - m.l - m.r) / (todos.length - 1));
  const y = v => m.t + (hi - v) * (H - m.t - m.b) / (hi - lo || 1);

  const leyenda = document.createElement("div");
  leyenda.className = "leyenda-graf";
  leyenda.innerHTML = '<span><i style="background:var(--s1)"></i>Cierre real</span>'
    + '<span style="color:var(--s1)"><i class="punteada"></i><span style="color:var(--tinta-2)">Proyección</span></span>';
  cont.append(leyenda);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Saldo de cierre por mes, real y proyectado" }, cont);

  marcas.forEach(v => {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "eje",
                 style: v === 0 ? "stroke:var(--tenue)" : "" }, svg);
    el("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = copCorto(v);
  });
  const cadaCuanto = Math.ceil(todos.length / Math.max(1, Math.floor((W - m.l - m.r) / 52)));
  todos.forEach((mm, i) => {
    if (i % cadaCuanto && i !== todos.length - 1) return;
    el("text", { x: x(i), y: H - 6, "text-anchor": "middle",
                 style: mm === actual ? "fill:var(--tinta);font-weight:600" : "" }, svg).textContent = mesCorto(mm);
  });

  // Lavado bajo lo real, línea real y línea proyectada.
  const pr = reales.map((p, i) => [x(i), y(p.saldo)]);
  const base = y(Math.max(lo, Math.min(0, hi)));
  if (pr.length > 1) {
    el("path", { d: `M${pr[0][0]},${base} ` + pr.map(p => "L" + p.join(",")).join(" ") + ` L${pr[pr.length - 1][0]},${base}Z`,
                 fill: "var(--s1)", opacity: .1 }, svg);
  }
  el("path", { d: "M" + pr.map(p => p.join(",")).join(" L"), class: "linea", stroke: "var(--s1)" }, svg);
  const off = reales.length - 1;
  const pp = puntosProy.map((p, i) => [x(off + i), y(p.saldo)]);
  el("path", { d: "M" + pp.map(p => p.join(",")).join(" L"), class: "linea", stroke: "var(--s1)",
               "stroke-dasharray": "5 5", opacity: .85 }, svg);

  // Punto final de lo real con su etiqueta, y el de la proyección.
  const fin = pr[pr.length - 1];
  el("circle", { cx: fin[0], cy: fin[1], r: 5, fill: "var(--s1)", stroke: "var(--hoja)", "stroke-width": 2 }, svg);
  const finP = pp[pp.length - 1];
  el("circle", { cx: finP[0], cy: finP[1], r: 4.5, fill: "var(--hoja)", stroke: "var(--s1)", "stroke-width": 2 }, svg);
  const etq = el("text", { x: finP[0] - 6, y: finP[1] - 10, "text-anchor": "end",
                           style: "fill:var(--tinta);font-weight:600" }, svg);
  etq.textContent = copCorto(proy.meses[proy.meses.length - 1].saldo);

  // Capa de lectura: guía vertical y tooltip por mes.
  const guia = el("line", { y1: m.t, y2: H - m.b, class: "guia", visibility: "hidden" }, svg);
  const marca = el("circle", { r: 5, fill: "var(--s1)", stroke: "var(--hoja)", "stroke-width": 2, visibility: "hidden" }, svg);
  const datos = [...reales.map(p => ({ ...p, real: true })), ...proy.meses];
  const hit = el("rect", { x: m.l - 10, y: 0, width: W - m.l - m.r + 20, height: H, class: "hit" }, svg);
  hit.addEventListener("mousemove", ev => {
    const caja = svg.getBoundingClientRect();
    const px = (ev.clientX - caja.left) * W / caja.width;
    const i = Math.max(0, Math.min(datos.length - 1, Math.round((px - m.l) / ((W - m.l - m.r) / Math.max(datos.length - 1, 1)))));
    const d = datos[i];
    guia.setAttribute("x1", x(i)); guia.setAttribute("x2", x(i)); guia.setAttribute("visibility", "visible");
    marca.setAttribute("cx", x(i)); marca.setAttribute("cy", y(d.saldo)); marca.setAttribute("visibility", "visible");
    let html = `<div class="t-tit">${esc(nombreMes(d.mes))}${d.real ? "" : " · proyectado"}</div>`
      + filaTip("", d.real ? (d.mes === actual ? "Saldo hoy" : "Cierre") : "Saldo estimado", cop(d.saldo));
    if (!d.real) {
      if (d.arrastre) html += filaTip("", "Resto de " + nombreMes(actual).split(" ")[0].toLowerCase(),
                                      (d.arrastre > 0 ? "+" : "−") + cop(Math.abs(d.arrastre)));
      html += filaTip("", "Sueldo", "+" + cop(d.sueldo)) + filaTip("", "Fijos", "−" + cop(d.fijos))
        + filaTip("", "Tarjeta", "−" + cop(d.tarjeta)) + filaTip("", "Gasto suelto (promedio)", "−" + cop(d.variable));
    }
    mostrarTip(html, ev);
  });
  hit.addEventListener("mouseleave", () => {
    guia.setAttribute("visibility", "hidden"); marca.setAttribute("visibility", "hidden"); ocultarTip();
  });

  const finProy = proy.meses[proy.meses.length - 1];
  $("saldoResumen").textContent = "en " + nombreMes(finProy.mes).toLowerCase() + ": " + cop(finProy.saldo);
  $("proyNota").textContent = "La proyección parte del saldo de hoy y le suma lo que falta de "
    + nombreMes(actual).split(" ")[0].toLowerCase() + " (sueldo por entrar menos lo pendiente). Luego cada mes suma el sueldo previsto y resta los fijos, el extracto de la tarjeta y "
    + cop(proy.variable) + " de gasto suelto, el promedio de los últimos meses. No cuenta ahorros ni préstamos por cobrar.";
}

/* ---------------------------------------------------------- en qué se fue */
function graficoCategorias(pares) {
  const cont = $("grafCats");
  cont.innerHTML = "";
  const total = pares.reduce((s, [, v]) => s + v, 0);
  if (!total) return;

  // Las categorías sin color propio se juntan en un solo tramo gris.
  const con = pares.filter(([k]) => COLOR_CATEGORIA[k]);
  const sin = pares.filter(([k]) => !COLOR_CATEGORIA[k]);
  const tramos = con.map(([k, v]) => ({ k, v, color: colorCat(k), partes: [[k, v]] }));
  if (sin.length) tramos.push({ k: sin.length === 1 ? sin[0][0] : "Otras", v: sin.reduce((s, [, v]) => s + v, 0),
                                 color: "var(--s-otro)", partes: sin });
  tramos.sort((a, b) => b.v - a.v);

  const S = 200, R = 92, r = 64, c = S / 2;
  const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, role: "img", "aria-label": "Consumo del mes por categoría" }, cont);
  let ang = -Math.PI / 2;
  const hueco = tramos.length > 1 ? 0.025 : 0;
  tramos.forEach(t => {
    const a = (t.v / total) * Math.PI * 2;
    const a0 = ang + hueco / 2, a1 = ang + a - hueco / 2;
    ang += a;
    if (a1 <= a0) return;
    const p = (rad, an) => [c + rad * Math.cos(an), c + rad * Math.sin(an)];
    const grande = a1 - a0 > Math.PI ? 1 : 0;
    const d = a >= Math.PI * 2 - 0.001
      ? `M${c},${c - R} A${R},${R} 0 1 1 ${c - 0.01},${c - R} L${c - 0.01},${c - r} A${r},${r} 0 1 0 ${c},${c - r}Z`
      : `M${p(R, a0)} A${R},${R} 0 ${grande} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${grande} 0 ${p(r, a0)}Z`;
    const seg = el("path", { d, fill: t.color, style: "cursor:default;transition:opacity .15s" }, svg);
    seg.addEventListener("mousemove", ev => {
      svg.querySelectorAll("path").forEach(x => { x.style.opacity = x === seg ? 1 : .35; });
      mostrarTip(`<div class="t-tit">${esc(t.k)} · ${Math.round(100 * t.v / total)}%</div>`
        + t.partes.map(([k, v]) => filaTip("", k, cop(v))).join(""), ev);
    });
    seg.addEventListener("mouseleave", () => { svg.querySelectorAll("path").forEach(x => { x.style.opacity = 1; }); ocultarTip(); });
  });
  el("text", { x: c, y: c + 2, "text-anchor": "middle", class: "total" }, svg).textContent = copCorto(total);
  el("text", { x: c, y: c + 19, "text-anchor": "middle", class: "sub" }, svg).textContent = "CONSUMO";
}

/* ------------------------------------------------------ entradas y salidas */
function graficoFlujo() {
  const cont = $("grafFlujo");
  cont.innerHTML = "";
  const meses = mesesRegistrados().filter(m => m <= mes).slice(-6);
  if (!meses.includes(mes)) { meses.push(mes); if (meses.length > 6) meses.shift(); }
  const datos = meses.map(m => { const r = resumenMes(m); return { mes: m, entra: r.entradas, sale: r.salidas }; });

  const leyenda = document.createElement("div");
  leyenda.className = "leyenda-graf";
  leyenda.innerHTML = '<span><i class="caja" style="background:var(--s1)"></i>Entradas</span>'
    + '<span><i class="caja" style="background:var(--s2)"></i>Salidas</span>';
  cont.append(leyenda);

  const W = Math.max(cont.clientWidth, 280), H = 200;
  const m = { t: 10, r: 6, b: 24, l: 56 };
  const { hi, marcas } = escalaY(0, Math.max(1, ...datos.flatMap(d => [d.entra, d.sale])), 4);
  const y = v => m.t + (hi - v) * (H - m.t - m.b) / hi;
  const banda = (W - m.l - m.r) / datos.length;
  const ancho = Math.min(22, (banda - 14) / 2);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Entradas y salidas por mes" }, cont);
  marcas.forEach(v => {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "eje" }, svg);
    el("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = copCorto(v);
  });

  // Columna con la punta redondeada y la base recta, sobre la línea del cero.
  const columna = (x0, v, color) => {
    const h = Math.max(0, y(0) - y(v)), rr = Math.min(4, h, ancho / 2);
    const top = y(0) - h;
    const d = `M${x0},${y(0)} L${x0},${top + rr} Q${x0},${top} ${x0 + rr},${top} L${x0 + ancho - rr},${top} `
            + `Q${x0 + ancho},${top} ${x0 + ancho},${top + rr} L${x0 + ancho},${y(0)}Z`;
    return el("path", { d, fill: color }, svg);
  };

  datos.forEach((d, i) => {
    const cx = m.l + banda * i + banda / 2;
    columna(cx - ancho - 1, d.entra, "var(--s1)");
    columna(cx + 1, d.sale, "var(--s2)");
    el("text", { x: cx, y: H - 6, "text-anchor": "middle",
                 style: d.mes === mes ? "fill:var(--tinta);font-weight:600" : "" }, svg).textContent = mesCorto(d.mes);
    const hit = el("rect", { x: m.l + banda * i, y: 0, width: banda, height: H, class: "hit", style: "cursor:default" }, svg);
    hit.addEventListener("mousemove", ev => mostrarTip(`<div class="t-tit">${esc(nombreMes(d.mes))}</div>`
      + filaTip("var(--s1)", "Entradas", cop(d.entra)) + filaTip("var(--s2)", "Salidas", cop(d.sale))
      + filaTip("", "Diferencia", (d.entra - d.sale >= 0 ? "+" : "") + cop(d.entra - d.sale)), ev));
    hit.addEventListener("mouseleave", ocultarTip);
  });

  const r = datos[datos.length - 1];
  $("flujoResumen").textContent = (r.entra - r.sale >= 0 ? "+" : "") + cop(r.entra - r.sale);
}

/* ------------------------------------------------------------ gasto por día */
function graficoDias() {
  const cont = $("grafDias");
  cont.innerHTML = "";
  const porDia = {};
  const sumar = (fecha, concepto, monto) => {
    if (mesDe(fecha) !== mes) return;
    (porDia[fecha] = porDia[fecha] || []).push([concepto, monto]);
  };
  estado.movimientos.filter(x => x.tipo === "gasto").forEach(x => sumar(x.fecha, x.concepto || x.categoria, x.monto));
  fijosDe(mes).filter(f => f.pagado[mes]).forEach(f => sumar(f.pagado[mes], f.concepto, montoVigente(f, mes)));
  estado.compras.filter(x => x.tipo === "compra").forEach(x => sumar(x.fecha, (x.concepto || x.categoria) + " (tarjeta)", x.monto));

  const totales = Object.fromEntries(Object.entries(porDia).map(([f, l]) => [f, l.reduce((s, [, v]) => s + v, 0)]));
  const valores = Object.values(totales).sort((a, b) => a - b);
  // Niveles por cuantiles: un arriendo no debe dejar todos los demás días en blanco.
  const corte = q => valores[Math.min(valores.length - 1, Math.floor(q * valores.length))] || 0;
  const cortes = [corte(.2), corte(.4), corte(.6), corte(.8)];
  const nivel = v => !v ? 0 : 1 + cortes.filter(c => v > c).length;

  const sem = document.createElement("div");
  sem.className = "dias-sem";
  ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].forEach(d => { const s = document.createElement("span"); s.textContent = d; sem.append(s); });
  cont.append(sem);

  const rejilla = document.createElement("div");
  rejilla.className = "dias";
  const primero = new Date(mes + "-01T12:00");
  const ultimo = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();
  for (let i = 0; i < (primero.getDay() + 6) % 7; i++) {
    const v = document.createElement("div"); v.className = "dia vacio-dia"; rejilla.append(v);
  }
  for (let d = 1; d <= ultimo; d++) {
    const f = mes + "-" + String(d).padStart(2, "0");
    const v = totales[f] || 0;
    const caja = document.createElement("div");
    caja.className = "dia n" + nivel(v) + (f === hoy() ? " hoy" : "");
    caja.textContent = d;
    caja.addEventListener("mousemove", ev => {
      const lista = (porDia[f] || []).sort((a, b) => b[1] - a[1]);
      mostrarTip(`<div class="t-tit">${esc(diaCorto(f))} · ${esc(cop(v))}</div>`
        + (lista.length ? lista.slice(0, 5).map(([k, m]) => filaTip("", k, cop(m))).join("")
            + (lista.length > 5 ? `<div>y ${lista.length - 5} más</div>` : "")
          : "Sin gastos"), ev);
    });
    caja.addEventListener("mouseleave", ocultarTip);
    rejilla.append(caja);
  }
  cont.append(rejilla);

  const escala = document.createElement("div");
  escala.className = "escala";
  escala.innerHTML = "<span>menos</span>" + [0, 1, 2, 3, 4, 5].map(n => `<i class="dia n${n}" style="aspect-ratio:auto;padding:0"></i>`).join("") + "<span>más</span>";
  cont.append(escala);

  const dias = Object.keys(totales).length;
  const total = valores.reduce((s, v) => s + v, 0);
  $("diasResumen").textContent = dias ? cop(Math.round(total / dias)) + " por día con gasto" : "";
}

/* ------------------------------------------------------------- patrimonio */
function graficoPatrimonio() {
  const cont = $("grafPatrimonio");
  cont.innerHTML = "";
  const meses = mesesRegistrados().filter(m => m <= mesDe(hoy()));
  if (!meses.length) { cont.innerHTML = '<div class="vacio">Aún no hay meses para graficar.</div>'; return; }
  const datos = meses.map(m => { const r = resumenMes(m); return { mes: m, valor: r.patrimonio, r }; });

  const W = Math.max(cont.clientWidth, 320), H = 220;
  const m = { t: 18, r: 18, b: 26, l: 62 };
  const { lo, hi, marcas } = escalaY(Math.min(0, ...datos.map(d => d.valor)), Math.max(...datos.map(d => d.valor)), 4);
  const x = i => m.l + (datos.length === 1 ? (W - m.l - m.r) / 2 : i * (W - m.l - m.r) / (datos.length - 1));
  const y = v => m.t + (hi - v) * (H - m.t - m.b) / (hi - lo || 1);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Patrimonio por mes" }, cont);
  marcas.forEach(v => {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "eje", style: v === 0 ? "stroke:var(--tenue)" : "" }, svg);
    el("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = copCorto(v);
  });
  datos.forEach((d, i) => el("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, svg).textContent = mesCorto(d.mes));
  const pts = datos.map((d, i) => [x(i), y(d.valor)]);
  if (pts.length > 1) el("path", { d: `M${pts[0][0]},${y(Math.max(lo, 0))} ` + pts.map(p => "L" + p.join(",")).join(" ")
                                     + ` L${pts[pts.length - 1][0]},${y(Math.max(lo, 0))}Z`, fill: "var(--s3)", opacity: .1 }, svg);
  el("path", { d: "M" + pts.map(p => p.join(",")).join(" L"), class: "linea", stroke: "var(--s3)" }, svg);
  pts.forEach(p => el("circle", { cx: p[0], cy: p[1], r: 4, fill: "var(--s3)", stroke: "var(--hoja)", "stroke-width": 2 }, svg));
  const fin = pts[pts.length - 1];
  el("text", { x: fin[0] - 6, y: fin[1] - 10, "text-anchor": "end", style: "fill:var(--tinta);font-weight:600" }, svg)
    .textContent = copCorto(datos[datos.length - 1].valor);

  const banda = (W - m.l - m.r) / Math.max(datos.length - 1, 1);
  datos.forEach((d, i) => {
    const hit = el("rect", { x: x(i) - banda / 2, y: 0, width: banda, height: H, class: "hit" }, svg);
    hit.addEventListener("mousemove", ev => mostrarTip(`<div class="t-tit">${esc(nombreMes(d.mes))} · ${esc(cop(d.valor))}</div>`
      + filaTip("", "Saldo", cop(d.r.saldo)) + filaTip("", "Ahorros", "+" + cop(d.r.ahorroTotal))
      + filaTip("", "Le deben", "+" + cop(d.r.teDeben)) + filaTip("", "Deuda tarjeta", "−" + cop(d.r.deudaTarjeta)), ev));
    hit.addEventListener("mouseleave", ocultarTip);
  });

  const ult = datos[datos.length - 1], ant = datos[datos.length - 2];
  $("patrimonioResumen").textContent = cop(ult.valor) + (ant ? " (" + (ult.valor >= ant.valor ? "+" : "−") + cop(Math.abs(ult.valor - ant.valor)) + " en el mes)" : "");
}

/* --------------------------------------------------------- el mes día a día */
/**
 * Todo lo que mueve la cuenta en el mes, en orden: lo que ya pasó y, en el mes en
 * curso o los siguientes, lo previsto (quincenas por recibir, fijos sin pagar, el
 * extracto de la tarjeta y los préstamos que vencen). Lo previsto que ya debió
 * pasar se pone hoy, porque sigue pendiente.
 */
function flujoDelMes(m) {
  const actual = mesDe(hoy());
  const c = resumenMes(m);
  const ev = [];
  const agregar = (fecha, monto, concepto, clase, previsto, extra) =>
    ev.push({ fecha, monto, concepto, clase, previsto: !!previsto, ...(extra || {}) });

  estado.movimientos.filter(x => mesDe(x.fecha) === m).forEach(x => {
    const entra = esEntrada(x.tipo);
    agregar(x.fecha, entra ? x.monto : -x.monto, x.concepto || x.categoria,
            x.sueldo ? "sueldo" : x.tipo === "aporte" || x.tipo === "retiro" ? "ahorro" : entra ? "ingreso" : "gasto");
  });
  fijosDe(m).filter(f => f.pagado[m]).forEach(f => agregar(f.pagado[m], -montoVigente(f, m), f.concepto, "fijo"));
  const t = tarjetaDelMes(m);
  if (estado.tarjeta) Object.values(estado.tarjeta.pagos).filter(p => mesDe(p.fecha) === m)
    .forEach(p => agregar(p.fecha, -p.monto, "Pago de la tarjeta", "tarjeta"));
  estado.compras.filter(x => x.tipo === "avance" && mesDe(x.fecha) === m)
    .forEach(x => agregar(x.fecha, x.monto, x.concepto || "Avance a la cuenta", "avance"));
  estado.prestamos.forEach(p => {
    if (mesDe(p.fecha) === m) agregar(p.fecha, -p.monto, "Préstamo a " + p.persona, "prestamo");
    p.abonos.filter(a => mesDe(a.fecha) === m).forEach(a => agregar(a.fecha, a.monto, p.persona + " devolvió", "prestamo"));
  });

  if (m >= actual) {
    const desde = m === actual ? hoy() : m + "-01";
    const cuando = f => (f < desde ? desde : f);
    sueldosDe(m).filter(s => enVigencia(s, m)).forEach(s => cuotasDe(s, m).forEach(q => {
      const falta = q.monto - q.recibido;
      if (falta > 0) agregar(cuando(q.fecha), falta, s.concepto + " · " + q.etiqueta.toLowerCase(), "sueldo", true);
    }));
    fijosDe(m).filter(f => enVigencia(f, m) && !f.pagado[m]).forEach(f => {
      const d = diaHabitual(f);
      agregar(cuando(d ? fechaEn(m, d) : m + "-01"), -montoVigente(f, m), f.concepto, "fijo", true, { sinDia: !d });
    });
    if (t.total && !t.pago) agregar(cuando(fechaDePago(m)), -t.total, "Pago de la tarjeta", "tarjeta", true);
    estado.prestamos.forEach(p => {
      const e = estadoPrestamo(p);
      if (e.pendiente && p.acordada && (mesDe(p.acordada) === m || (m === actual && p.acordada < m)))
        agregar(cuando(p.acordada), e.pendiente, p.persona + " le paga", "prestamo", true);
    });
  }

  // El mismo día, primero lo que entra: así el saldo no baja de mentiras antes del sueldo.
  ev.sort((a, b) => a.fecha.localeCompare(b.fecha) || b.monto - a.monto);
  let saldo = c.inicial;
  ev.forEach(e => { saldo += e.monto; e.saldo = saldo; });
  return { inicial: c.inicial, eventos: ev, final: saldo };
}

/** Los periodos del mes siguen al sueldo: quincenas, semanas o el mes entero. */
function periodosDelMes(m, flujo) {
  const ultimo = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const sueldo = sueldosDe(m).find(s => enVigencia(s, m));
  const cortes = sueldo ? cuotasDe(sueldo, m).map(q => Number(q.fecha.slice(8, 10))) : [ultimo];
  cortes[cortes.length - 1] = ultimo;
  const nombres = sueldo && FRECUENCIAS[sueldo.frecuencia] === 2 ? ["1ª quincena", "2ª quincena"]
    : sueldo && FRECUENCIAS[sueldo.frecuencia] === 4 ? ["Semana 1", "Semana 2", "Semana 3", "Semana 4"] : ["Todo el mes"];
  let inicio = 1, saldoInicio = flujo.inicial;
  return cortes.map((fin, i) => {
    const dentro = flujo.eventos.filter(e => { const d = Number(e.fecha.slice(8, 10)); return d >= inicio && d <= fin; });
    let minimo = saldoInicio, diaMinimo = inicio;
    dentro.forEach(e => { if (e.saldo < minimo) { minimo = e.saldo; diaMinimo = Number(e.fecha.slice(8, 10)); } });
    const r = { nombre: nombres[i] || "Periodo " + (i + 1), inicio, fin, saldoInicio,
      entra: dentro.filter(e => e.monto > 0).reduce((s, e) => s + e.monto, 0),
      sale: -dentro.filter(e => e.monto < 0).reduce((s, e) => s + e.monto, 0),
      saldoFin: dentro.length ? dentro[dentro.length - 1].saldo : saldoInicio,
      minimo, diaMinimo, previsto: dentro.some(e => e.previsto) };
    inicio = fin + 1; saldoInicio = r.saldoFin;
    return r;
  });
}

/**
 * Un tag tipo pastilla, con la línea corta que lo une a su punto. Puede llevar
 * varias líneas (lo de un mismo día); cy es el borde del tag más cercano al punto.
 */
function etiqueta(svg, cx, cy, lineas, color, previsto, sinLinea, px, py) {
  if (!Array.isArray(lineas)) lineas = [{ texto: lineas }];
  const g = el("g", { class: "tag" }, svg);
  const alto = 6 + lineas.length * 14, arriba = py === undefined || cy < py;
  const y0 = arriba ? cy - alto : cy;
  if (!sinLinea) el("line", { x1: cx, y1: cy, x2: px, y2: py, stroke: color, "stroke-width": 1, "stroke-opacity": .6 }, g);
  const fondo = el("rect", { rx: 9, ry: 9, fill: "var(--hoja)", stroke: color, "stroke-width": 1.2,
                             "stroke-dasharray": previsto ? "3 2" : "" }, g);
  let ancho = 0;
  lineas.forEach((l, i) => {
    const t = el("text", { x: cx, y: y0 + 14 + i * 14, "text-anchor": "middle", class: "tag-texto" }, g);
    t.textContent = l.texto;
    if (l.color) t.style.fill = l.color;
    ancho = Math.max(ancho, t.getComputedTextLength() + 16);
  });
  fondo.setAttribute("x", cx - ancho / 2); fondo.setAttribute("y", y0);
  fondo.setAttribute("width", ancho); fondo.setAttribute("height", alto);
  return g;
}

/**
 * Curva suave que pasa por cada punto sin pasarse de largo (monotónica): entre dos
 * días con el mismo saldo queda plana, y en los cambios sube o baja sin ondular.
 */
function curvaSuave(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  const n = pts.length, dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1);
  }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

let lineaAnimada = "";   // el mes que ya se dibujó con animación, para no repetirla en cada cambio

function graficoLineaTiempo() {
  const cont = $("grafLinea");
  cont.innerHTML = "";
  const flujo = flujoDelMes(mes);
  const periodos = periodosDelMes(mes, flujo);
  const ultimo = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();
  const actual = mesDe(hoy());
  const diaHoy = actual === mes ? Number(hoy().slice(8, 10)) : null;
  // Hasta dónde llega lo ya ocurrido: hoy en el mes en curso, todo en los pasados, nada en los futuros.
  const hasta = mes < actual ? ultimo : mes > actual ? 0 : diaHoy;

  const W = Math.max(cont.clientWidth, 320), H = 280;
  const m = { t: 34, r: 18, b: 30, l: 58 };

  // Saldo al cierre de cada día: el punto 0 es con lo que arrancó el mes.
  const porDia = {};
  flujo.eventos.forEach(e => { (porDia[Number(e.fecha.slice(8, 10))] = porDia[Number(e.fecha.slice(8, 10))] || []).push(e); });
  const saldoDia = [flujo.inicial];
  for (let d = 1; d <= ultimo; d++) saldoDia[d] = porDia[d] ? porDia[d][porDia[d].length - 1].saldo : saldoDia[d - 1];

  const entradas = [0], salidas = [0];
  for (let d = 1; d <= hasta; d++) {
    entradas.push(entradas[d - 1]);
    salidas.push(salidas[d - 1]);
    for (const e of porDia[d] || []) {
      if (e.previsto) continue;
      if (e.monto > 0) entradas[d] += e.monto;
      else salidas[d] -= e.monto;
    }
  }
  const series = [[entradas, "--s3", "Entradas acumuladas"], [salidas, "--s2", "Salidas acumuladas"]]
    .filter(([valores]) => valores.at(-1) > 0);
  const { lo, hi, marcas } = escalaY(Math.min(0, ...saldoDia), Math.max(...saldoDia, entradas.at(-1), salidas.at(-1)), 3);
  const x = d => m.l + d * (W - m.l - m.r) / ultimo;
  const y = v => m.t + (hi - v) * (H - m.t - m.b) / (hi - lo || 1);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Saldo de la cuenta día a día, entradas y salidas acumuladas" }, cont);

  // Quincenas: franja suave y su nombre pequeño en la esquina.
  periodos.forEach((p, i) => {
    const x0 = x(p.inicio - 1), x1 = x(p.fin);
    if (i % 2) el("rect", { x: x0, y: m.t, width: x1 - x0, height: H - m.t - m.b, fill: "var(--hoja-2)" }, svg);
    if (periodos.length > 1) el("text", { x: x0 + 6, y: m.t - 10, class: "rotulo-periodo" }, svg).textContent = p.nombre.toUpperCase();
  });
  marcas.forEach(v => {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "eje",
                 style: v === 0 ? "stroke:var(--vino);stroke-opacity:.45;stroke-dasharray:3 3" : "" }, svg);
    el("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = copCorto(v);
  });
  [1, 5, 10, 15, 20, 25, ultimo].forEach(d => el("text", { x: x(d), y: H - 10, "text-anchor": "middle" }, svg).textContent = d);

  for (const [valores, color] of series) {
    const curva = valores.slice(1).reduce((d, v, i) => d + ` H${x(i + 1)} V${y(v)}`, `M${x(0)},${y(0)}`);
    el("path", { d: curva, class: "linea linea-acumulada", stroke: `var(${color})` }, svg);
  }

  // Lo que falta del mes se dibuja punteado.
  const pts = saldoDia.map((v, d) => [x(d), y(v)]);
  const futuro = pts.slice(hasta);
  if (futuro.length > 1) el("path", { d: curvaSuave(futuro), class: "linea linea-prevista" }, svg);
  const pasado = pts.slice(0, hasta + 1);
  if (pasado.length > 1) {
    const curva = curvaSuave(pasado);
    const linea = el("path", { d: curva, class: "linea linea-real" }, svg);
    // Se dibuja de izquierda a derecha la primera vez que se abre el mes.
    if (lineaAnimada !== mes && flujo.eventos.length) {
      const largo = linea.getTotalLength();
      linea.style.strokeDasharray = largo;
      linea.style.strokeDashoffset = largo;
      linea.getBoundingClientRect();   // fija el estado inicial antes de animar
      linea.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.3,.7,.3,1)";
      linea.style.strokeDashoffset = 0;
      lineaAnimada = mes;
    }
  }
  if (diaHoy) {
    el("line", { x1: x(diaHoy), x2: x(diaHoy), y1: m.t, y2: H - m.b, class: "linea-hoy" }, svg);
    const yh = y(saldoDia[diaHoy]);
    el("circle", { cx: x(diaHoy), cy: yh, r: 6, fill: "var(--tinta)", stroke: "var(--hoja)", "stroke-width": 3 }, svg);
    etiqueta(svg, x(diaHoy), H - m.b - 2, "hoy", "var(--tinta)", false, true);
  }

  // Puntos: chicos para lo menor; los grandes llevan su tag pegado.
  const tope = Math.max(1, ...flujo.eventos.map(e => Math.abs(e.monto)));
  const grandes = {};
  Object.entries(porDia).forEach(([d, lista]) => {
    d = Number(d);
    lista.forEach(e => {
      const color = e.monto > 0 ? "var(--s1)" : "var(--s2)";
      // El sueldo y el pago de la tarjeta siempre llevan tag; lo demás, si pesa.
      const grande = Math.abs(e.monto) >= tope * 0.2 || e.clase === "tarjeta" || e.clase === "sueldo";
      el("circle", { cx: x(d), cy: y(saldoDia[d]), r: grande ? 5 : 3,
        fill: e.previsto ? "var(--hoja)" : color, stroke: e.previsto ? color : "var(--hoja)",
        "stroke-width": e.previsto ? 1.5 : 1.5, class: "punto" + (d > hasta ? " punto-previsto" : "") }, svg);
      if (grande) (grandes[d] = grandes[d] || []).push(e);
    });
  });

  // Los tags se ubican arriba si entra plata y abajo si sale; si chocan, se apilan.
  const ocupados = [];
  const choca = r => ocupados.some(o => r.x < o.x + o.w + 4 && r.x + r.w + 4 > o.x && r.y < o.y + o.h + 3 && r.y + r.h + 3 > o.y);
  // Un tag por día con lo grande de ese día (hasta tres líneas); va arriba si el día
  // dejó más plata de la que sacó, y abajo si no.
  const linea = e => {
    const nombre = e.concepto.split(" · ")[0];
    return { texto: (e.monto > 0 ? "+" : "−") + copCorto(Math.abs(e.monto)) + "  " + (nombre.length > 18 ? nombre.slice(0, 17) + "…" : nombre),
             color: e.monto > 0 ? "var(--s1)" : "var(--s2)" };
  };
  Object.entries(grandes)
    .map(([d, lista]) => ({ d: Number(d), lista: lista.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto)) }))
    .sort((a, b) => Math.abs(b.lista[0].monto) - Math.abs(a.lista[0].monto)).slice(0, 7)
    .sort((a, b) => a.d - b.d)
    .forEach(({ d, lista }) => {
      const neto = lista.reduce((s, e) => s + e.monto, 0), arriba = neto > 0;
      const lineas = lista.slice(0, 3).map(linea);
      if (lista.length > 3) lineas.push({ texto: "y " + (lista.length - 3) + " más" });
      const px = x(d), py = y(saldoDia[d]);
      const color = lista.length > 1 ? "var(--tinta-2)" : arriba ? "var(--s1)" : "var(--s2)";
      const previsto = lista.every(e => e.previsto);
      // Primero del lado que le toca; si no cabe, del otro.
      for (let paso = 0; paso < 8; paso++) {
        const lado = (paso < 4 ? arriba : !arriba) ? -1 : 1;
        const ty = py + lado * (14 + (paso % 4) * 18);
        const tag = etiqueta(svg, px, ty, lineas, color, previsto, false, px, py);
        const caja = tag.getBBox();
        const corrido = Math.max(m.l - caja.x, 0) - Math.max(caja.x + caja.width - (W - 2), 0);
        if (corrido) tag.setAttribute("transform", `translate(${corrido},0)`);
        const r = { x: caja.x + corrido, y: caja.y, w: caja.width, h: caja.height };
        if (choca(r) || r.y < 0 || r.y + r.h > H - m.b + 2) { tag.remove(); continue; }
        ocupados.push(r);
        tag.querySelector("line").setAttribute("x2", px - corrido);
        tag.querySelector("line").setAttribute("y2", py);
        break;
      }
    });

  // Lectura por día.
  const ancho = (W - m.l - m.r) / ultimo;
  for (let d = 1; d <= ultimo; d++) {
    const fecha = mes + "-" + String(d).padStart(2, "0");
    const lista = porDia[d] || [];
    const hit = el("rect", { x: x(d) - ancho / 2, y: 0, width: ancho, height: H, class: "hit" }, svg);
    hit.addEventListener("mousemove", ev => mostrarTip(`<div class="t-tit">${esc(diaCorto(fecha))} · queda ${esc(cop(saldoDia[d]))}</div>`
      + (lista.length ? lista.map(e => filaTip(e.monto > 0 ? "var(--s1)" : "var(--s2)",
          e.concepto + (e.previsto ? " (previsto)" : ""), (e.monto > 0 ? "+" : "−") + cop(Math.abs(e.monto)))).join("")
        : "<div>Sin movimientos</div>"), ev));
    hit.addEventListener("mouseleave", ocultarTip);
  }

  const leyenda = document.createElement("div");
  leyenda.className = "leyenda-graf";
  leyenda.innerHTML = '<span><i style="background:var(--s1)"></i>Saldo</span>'
    + '<span><i class="punteada" style="color:var(--s1);opacity:.55"></i>Saldo previsto</span>'
    + series.map(([, color, nombre]) => `<span><i style="background:var(${color})"></i>${nombre}</span>`).join("");
  cont.prepend(leyenda);
  // Resumen por periodo: lo que entra, lo que sale, con cuánto termina y el punto más bajo.
  const caja = $("periodos");
  caja.innerHTML = "";
  periodos.forEach(p => {
    const d = document.createElement("div");
    d.className = "periodo" + (p.minimo < 0 ? " corto" : "");
    d.innerHTML = "<b></b><small></small><div class='p-fila'><span>Entra</span><em class='entra'></em></div>"
      + "<div class='p-fila'><span>Sale</span><em class='sale'></em></div><div class='p-fila total'><span></span><em class='queda'></em></div><p></p>";
    d.querySelector("b").textContent = p.nombre;
    d.querySelector("small").textContent = p.inicio + "–" + p.fin + " de " + nombreMes(mes).split(" ")[0].toLowerCase() + (p.previsto ? " · incluye lo previsto" : "");
    d.querySelector(".entra").textContent = "+" + cop(p.entra);
    d.querySelector(".sale").textContent = "−" + cop(p.sale);
    d.querySelector(".total span").textContent = "Queda al " + p.fin;
    d.querySelector(".queda").textContent = cop(p.saldoFin);
    d.querySelector("p").textContent = p.minimo < 0
      ? "Se queda corto: llega a " + cop(p.minimo) + " el " + p.diaMinimo + ", antes de lo que entra."
      : "Lo más bajo: " + cop(p.minimo) + " el " + p.diaMinimo + ".";
    caja.append(d);
  });
  $("lineaResumen").textContent = "cierra en " + cop(flujo.final) + (flujo.eventos.some(e => e.previsto) ? " si todo llega a tiempo" : "");
}

function renderGraficos(pares) {
  if (document.body.dataset.vista === "historia") graficoPatrimonio();
  if (document.body.dataset.vista !== "resumen") return;
  graficoLineaTiempo();
  graficoSaldo();
  graficoCategorias(pares);
  graficoFlujo();
  graficoDias();
}
