"use strict";

const CATEGORIAS = ["Vivienda", "Servicios", "Alimentación", "Transporte", "Salud",
                    "Educación", "Suscripciones", "Ocio", "Deudas", "Otros"];

const ORIGENES = ["Sueldo", "Trabajo extra", "Regalo", "Reembolso", "Venta",
                  "Intereses", "Préstamo recibido", "Otros"];

const VACIO = { version: 3, saldoInicial: {}, fijos: [], ahorros: [], sueldos: [], movimientos: [],
                tarjeta: null, compras: [], prestamos: [], presupuestos: {} };

const FRECUENCIAS = { mensual: 1, quincenal: 2, semanal: 4 };

const ENTRADAS = ["ingreso", "retiro"];

let estado = structuredClone(VACIO);
let contextoSesion = null;
let mes = new Date().toISOString().slice(0, 7);
let temporizador = null;
let sinGuardar = false;
let libretaCargada = false;
let filtroMovs = "todo";
let editando = null;      // id del fijo o del ahorro que se está editando
let editandoMov = null;   // id del gasto, ingreso, aporte o retiro que se está editando
let editandoMovEn = "";  // lista donde se abrió: "movs" o "ingresos"
let accion = {};          // {id, tipo} del ahorro al que se le está abonando o retirando
let verTerminados = false;

const $ = id => document.getElementById(id);
const cop = n => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
const hoy = () => new Date().toISOString().slice(0, 10);
const mesDe = f => (f || "").slice(0, 7);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esEntrada = tipo => ENTRADAS.includes(tipo);

/* ------------------------------------------------------------------ meses */
function mesMas(m, paso) {
  const [a, s] = m.split("-").map(Number);
  return new Date(Date.UTC(a, s - 1 + paso, 1)).toISOString().slice(0, 7);
}
const mesAnterior = m => mesMas(m, -1);
const mesSiguiente = m => mesMas(m, 1);

function nombreMes(m) {
  const t = new Date(m + "-01T12:00").toLocaleDateString("es-CO", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const diaCorto = f => new Date(f + "T12:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short" });

/** Un día razonable para fechar algo dentro del mes que se está mirando. */
function diaDentroDe(m) {
  return mesDe(hoy()) === m ? hoy() : m + "-01";
}

/** Todos los meses con algún rastro: saldo escrito a mano, movimiento, fijo o ahorro. */
function mesesRegistrados() {
  const s = new Set(Object.keys(estado.saldoInicial || {}));
  estado.movimientos.forEach(m => s.add(mesDe(m.fecha)));
  estado.fijos.forEach(f => Object.keys(f.pagado || {}).forEach(k => s.add(k)));
  if (estado.tarjeta) Object.entries(estado.tarjeta.pagos).forEach(([k, p]) => { s.add(k); s.add(mesDe(p.fecha)); });
  estado.compras.forEach(c => { if (c.tipo === "avance") s.add(mesDe(c.fecha)); });
  estado.prestamos.forEach(p => {
    s.add(mesDe(p.fecha));
    p.abonos.forEach(a => s.add(mesDe(a.fecha)));
  });
  return [...s].filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
}

/* ---------------------------------------------------------- sincronización */
function marcar(texto, clase) {
  const e = $("estado");
  e.textContent = texto;
  e.className = "estado" + (clase ? " " + clase : "");
}

/** Convierte un mapa mes -> algo en mes -> fecha del día, tolerando el viejo true. */
function normalizarMarcas(mapa) {
  const salida = {};
  for (const [k, v] of Object.entries(mapa || {})) {
    if (v) salida[k] = typeof v === "string" ? v : k + "-01";
  }
  return salida;
}

function normalizarMontos(mapa) {
  const salida = {};
  for (const [k, v] of Object.entries(mapa || {})) salida[k] = Number(v) || 0;
  return salida;
}

/**
 * Antes el aporte al ahorro era una casilla de sí o no por el monto de la meta.
 * Ahora cada abono es un movimiento con su propio monto, así que se convierten.
 */
function migrarAportes(ahorros, movimientos) {
  ahorros.forEach(a => {
    for (const [m, marca] of Object.entries(a.aportado || {})) {
      if (!marca) continue;
      movimientos.push({
        id: uid(), fecha: typeof marca === "string" ? marca : m + "-01",
        tipo: "aporte", concepto: "Abono a " + (a.concepto || a.nombre || "ahorro"),
        categoria: "Otros", monto: montoVigente(a, m), ahorro: a.id
      });
    }
    delete a.aportado;
  });
}

function normalizar(d) {
  const saldoInicial = {};
  for (const [k, v] of Object.entries(d.saldoInicial || {})) {
    if (v !== null && v !== "" && !Number.isNaN(Number(v))) saldoInicial[k] = Number(v);
  }
  const limpio = {
    version: 3,
    guiaVista: d.guiaVista === true,
    guiaVistas: Object.fromEntries(VISTAS.filter(v => d.guiaVistas?.[v] === true).map(v => [v, true])),
    saldoInicial,
    fijos: (d.fijos || []).map(f => ({
      id: f.id || uid(),
      concepto: f.concepto || "",
      categoria: f.categoria || "Otros",
      monto: Number(f.monto) || 0,
      montos: normalizarMontos(f.montos),
      desde: f.desde || null,
      hasta: f.hasta || null,
      pagado: normalizarMarcas(f.pagado)
    })),
    ahorros: (d.ahorros || []).map(a => ({
      id: a.id || uid(),
      concepto: a.concepto || a.nombre || "",
      objetivo: Number(a.objetivo) || 0,
      inicial: Number(a.inicial) || 0,
      monto: Number(a.monto) || 0,
      montos: normalizarMontos(a.montos),
      desde: a.desde || null,
      hasta: a.hasta || null,
      aportado: normalizarMarcas(a.aportado)
    })),
    sueldos: (d.sueldos || []).map(s => ({
      id: s.id || uid(),
      concepto: s.concepto || "Sueldo",
      monto: Number(s.monto) || 0,
      frecuencia: FRECUENCIAS[s.frecuencia] ? s.frecuencia : "mensual",
      montos: normalizarMontos(s.montos),
      desde: s.desde || null,
      hasta: s.hasta || null
    })),
    movimientos: (d.movimientos || []).map(m => ({
      id: m.id || uid(), fecha: m.fecha || hoy(), tipo: m.tipo || "gasto",
      concepto: m.concepto || "", categoria: m.categoria || "Otros",
      monto: Number(m.monto) || 0, ahorro: m.ahorro || null,
      sueldo: m.sueldo || null,
      cuota: Number.isInteger(m.cuota) ? m.cuota : null
    })),
    tarjeta: normalizarTarjeta(d.tarjeta),
    compras: (d.compras || []).map(normalizarCompra),
    prestamos: (d.prestamos || []).map(normalizarPrestamo),
    presupuestos: normalizarPresupuestos(d.presupuestos)
  };
  migrarAportes(limpio.ahorros, limpio.movimientos);
  return limpio;
}

async function cargar() {
  try {
    const r = await fetch("/api/datos", { cache: "no-store", headers: { "X-Libreta-Sesion": contextoSesion || "" } });
    if (r.status === 401 || r.status === 409) { manejarCambioSesion(sinGuardar); return; }
    if (!r.ok) throw new Error(r.status);
    estado = normalizar(await r.json());
    document.querySelector(".app").style.display = "";
    render();
    libretaCargada = true;
    marcar("Al día", "ok");
    $("cargaLibreta").hidden = true;
  } catch (e) {
    if (!libretaCargada) {
      document.querySelector(".app").style.display = "none";
      $("cargaLibreta").textContent = "No se pudo cargar la libreta. Revise el archivo de datos y sus respaldos, y vuelva a abrir la aplicación.";
    }
    marcar("No se pudo cargar la libreta", "mal");
  }
}

function guardar() {
  if (!libretaCargada) return;
  sinGuardar = true;
  marcar("Guardando...", "pend");
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    try {
      const r = await fetch("/api/datos", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Libreta-Sesion": contextoSesion || "" },
        body: JSON.stringify(estado)
      });
      if (!r.ok) {
        const error = await r.json().catch(() => ({}));
        if (r.status === 401 || r.status === 409) { manejarCambioSesion(sinGuardar); return; }
        throw new Error(error.error || r.status);
      }
      sinGuardar = false;
      marcar("Guardado " + new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }), "ok");
    } catch (e) {
      marcar("No se pudo guardar: " + e.message, "mal");
    }
  }, 400);
}

/**
 * Guarda ya, sin esperar el temporizador. La ventana de escritorio lo llama al
 * cerrarse; es síncrono para que termine antes de que se apague el servidor.
 */
function guardarAhora() {
  if (!sinGuardar) return true;
  clearTimeout(temporizador);
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", "/api/datos", false);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("X-Libreta-Sesion", contextoSesion || "");
    xhr.send(JSON.stringify(estado));
    if (xhr.status === 401 || xhr.status === 409) { manejarCambioSesion(true); return false; }
    sinGuardar = xhr.status !== 200;
  } catch (e) { /* si falla, queda el respaldo del último guardado */ }
  return !sinGuardar;
}
window.guardarAhora = guardarAhora;

function manejarCambioSesion(conCambios) {
  const app = document.querySelector(".app");
  if (app) app.style.display = "none";
  $("authScreen").hidden = true;
  $("cargaLibreta").hidden = false;
  $("cargaLibreta").textContent = conCambios
    ? "El perfil cambió en otra ventana. Hay cambios que no se pudieron guardar; actualizando…"
    : "El perfil cambió en otra ventana. Actualizando…";
  alert(conCambios
    ? "El perfil cambió en otra ventana antes de guardar. Hay cambios que no se pudieron guardar. La libreta se actualizará ahora."
    : "El perfil cambió en otra ventana. La libreta se actualizará ahora.");
  location.replace(location.pathname);
}

function exportar() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(estado, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "gastos_" + hoy() + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

function importar(file) {
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const datos = JSON.parse(lector.result);
      if (!datos || !Array.isArray(datos.movimientos)) throw new Error("formato");
      estado = normalizar(datos);
      render();
      guardar();
    } catch (e) {
      marcar("Ese archivo no tiene el formato esperado", "mal");
    }
  };
  lector.readAsText(file);
}

/* -------------------------------------------------- fijos y ahorros fijos */
/** El monto vigente en ese mes: el último cambio anotado hasta esa fecha. */
function montoVigente(item, m) {
  let valor = item.monto, mejor = "";
  for (const [k, v] of Object.entries(item.montos || {})) {
    if (k <= m && k >= mejor) { mejor = k; valor = v; }
  }
  return valor;
}

function enVigencia(item, m) {
  return (!item.desde || m >= item.desde) && (!item.hasta || m <= item.hasta);
}

/** Vigentes en el mes, más cualquiera que ya tenga movimiento anotado ahí. */
function fijosDe(m) {
  return estado.fijos.filter(f => enVigencia(f, m) || f.pagado[m]);
}

function ahorrosDe(m) {
  return estado.ahorros.filter(a => enVigencia(a, m) || abonadoEnMes(a, m));
}

/** Lo que se abonó a ese bolsillo dentro del mes, sea cuanto sea. */
function abonadoEnMes(a, m) {
  return estado.movimientos
    .filter(x => x.ahorro === a.id && mesDe(x.fecha) === m && x.tipo === "aporte")
    .reduce((s, x) => s + x.monto, 0);
}

/**
 * Lo acumulado en un ahorro hasta el final de ese mes: los aportes mensuales
 * marcados, más los movimientos sueltos asignados a ese bolsillo.
 */
function acumuladoAhorro(a, m) {
  // Lo que ya tenía guardado antes de empezar a llevar la cuenta aquí.
  let total = (!a.desde || m >= a.desde) ? a.inicial : 0;
  const fin = m + "-32";
  estado.movimientos.forEach(x => {
    if (x.ahorro !== a.id || x.fecha > fin) return;
    if (x.tipo === "aporte") total += x.monto;
    if (x.tipo === "retiro") total -= x.monto;
  });
  return total;
}

/** Ahorro total: los bolsillos con nombre más los aportes sueltos sin bolsillo. */
function ahorroHasta(m) {
  const fin = m + "-32";
  const sueltos = estado.movimientos.reduce((s, x) => {
    if (x.ahorro || x.fecha > fin) return s;
    return s + (x.tipo === "aporte" ? x.monto : 0) - (x.tipo === "retiro" ? x.monto : 0);
  }, 0);
  return sueltos + estado.ahorros.reduce((s, a) => s + acumuladoAhorro(a, m), 0);
}

const nombreAhorro = id => (estado.ahorros.find(a => a.id === id) || {}).concepto || "";
const nombreSueldo = id => (estado.sueldos.find(s => s.id === id) || {}).concepto || "";

/* ------------------------------------------------------- sueldo esperado */
/**
 * Los sueldos son una previsión, no plata en la cuenta: hasta que no se
 * registra el ingreso real, no tocan el saldo. Así, si el trabajo se acaba,
 * el mes siguiente simplemente queda sin registrar.
 */
function sueldosDe(m) {
  return estado.sueldos.filter(s => enVigencia(s, m) || recibidoDe(s, m) > 0);
}

/** Los pagos previstos del mes: uno al mes, dos si es quincenal, cuatro si semanal. */
function cuotasDe(s, m) {
  const veces = FRECUENCIAS[s.frecuencia] || 1;
  const monto = montoVigente(s, m);
  const ultimo = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const nombres = {
    mensual: ["Pago del mes"],
    quincenal: ["Primera quincena", "Segunda quincena"],
    semanal: ["Semana 1", "Semana 2", "Semana 3", "Semana 4"]
  }[s.frecuencia] || ["Pago del mes"];

  return nombres.map((etiqueta, i) => {
    const dia = Math.min(Math.floor(ultimo * (i + 1) / veces), ultimo);
    return {
      indice: i, etiqueta, monto,
      fecha: m + "-" + String(dia).padStart(2, "0"),
      recibido: recibidoDe(s, m, i)
    };
  });
}

/** Lo ya cobrado de ese sueldo en el mes; con cuota, solo el de esa cuota. */
function recibidoDe(s, m, cuota) {
  return estado.movimientos
    .filter(x => x.sueldo === s.id && x.tipo === "ingreso" && mesDe(x.fecha) === m
                 && (cuota === undefined || x.cuota === cuota))
    .reduce((acc, x) => acc + x.monto, 0);
}

const esperadoDe = (s, m) => montoVigente(s, m) * (FRECUENCIAS[s.frecuencia] || 1);

/* ------------------------------------------------------------- cálculos */
const cacheResumen = new Map();

function delMes(m, tipo) {
  return estado.movimientos
    .filter(x => mesDe(x.fecha) === m && x.tipo === tipo)
    .reduce((s, x) => s + x.monto, 0);
}

/**
 * Saldo con el que arranca el mes. Si no se escribió a mano, se hereda el
 * cierre del último mes que tenga registros: así la historia no se corta.
 */
function inicialDe(m) {
  if (Object.prototype.hasOwnProperty.call(estado.saldoInicial, m)) {
    return { valor: Number(estado.saldoInicial[m]) || 0, manual: true };
  }
  const previo = mesesRegistrados().filter(x => x < m).pop();
  if (!previo) return { valor: 0, manual: false, previo: null };
  return { valor: resumenMes(previo).saldo, manual: false, previo };
}

function resumenMes(m) {
  if (cacheResumen.has(m)) return cacheResumen.get(m);
  cacheResumen.set(m, { saldo: 0 });          // corta cualquier ciclo raro

  const origen = inicialDe(m);
  const inicial = origen.valor;
  const ingresos = delMes(m, "ingreso");
  const variables = delMes(m, "gasto");
  const aportes = delMes(m, "aporte");
  const retiros = delMes(m, "retiro");

  let fijosPagados = 0, fijosPend = 0;
  fijosDe(m).forEach(f => {
    const monto = montoVigente(f, m);
    if (f.pagado[m]) fijosPagados += monto;
    else if (enVigencia(f, m)) fijosPend += monto;
  });

  // El ahorro es voluntario: cuenta lo que se abonó, pero lo que falta para la
  // meta mensual nunca se suma a lo comprometido ni recorta el disponible.
  let ahorroAbonado = 0, metaAhorro = 0;
  ahorrosDe(m).forEach(a => {
    ahorroAbonado += abonadoEnMes(a, m);
    if (enVigencia(a, m)) metaAhorro += montoVigente(a, m);
  });

  // El sueldo previsto se informa aparte: no entra al saldo hasta registrarlo.
  let sueldoEsperado = 0, sueldoRecibido = 0;
  sueldosDe(m).forEach(s => {
    if (enVigencia(s, m)) sueldoEsperado += esperadoDe(s, m);
    sueldoRecibido += recibidoDe(s, m);
  });

  // La tarjeta toca el saldo cuando se paga el extracto, no cuando se compra.
  // El avance sí es plata que llega a la mano el día que se saca.
  const tarjeta = tarjetaDelMes(m);
  // Lo pagado sale del saldo el mes en que se pagó, aunque sea el extracto de otro mes.
  const tarjetaPagada = estado.tarjeta
    ? Object.values(estado.tarjeta.pagos).filter(p => mesDe(p.fecha) === m).reduce((s, p) => s + p.monto, 0) : 0;
  const tarjetaPend = !tarjeta.pago ? tarjeta.total : 0;
  const avances = estado.compras
    .filter(c => c.tipo === "avance" && mesDe(c.fecha) === m)
    .reduce((s, c) => s + c.monto, 0);

  // Prestar saca plata de la cuenta; lo que devuelven vuelve a entrar.
  let prestado = 0, devuelto = 0;
  estado.prestamos.forEach(p => {
    if (mesDe(p.fecha) === m) prestado += p.monto;
    p.abonos.forEach(a => { if (mesDe(a.fecha) === m) devuelto += a.monto; });
  });

  const entradas = ingresos + retiros + avances + devuelto;
  const salidas = variables + aportes + fijosPagados + tarjetaPagada + prestado;
  const saldo = inicial + entradas - salidas;
  const pendiente = fijosPend + tarjetaPend;

  const r = {
    mes: m, inicial, inicialManual: origen.manual, inicialPrevio: origen.previo,
    ingresos, variables, aportes, retiros,
    fijosPagados, fijosPend, ahorroAbonado, metaAhorro, pendiente,
    porAhorrar: Math.max(metaAhorro - ahorroAbonado, 0),
    sueldoEsperado, sueldoRecibido, porRecibir: Math.max(sueldoEsperado - sueldoRecibido, 0),
    tarjetaPagada, tarjetaPend, avances, prestado, devuelto,
    entradas, salidas, saldo, libre: saldo - pendiente,
    gastado: variables + fijosPagados + tarjetaPagada + prestado,
    ahorroTotal: ahorroHasta(m),
    deudaTarjeta: deudaTarjeta(m), teDeben: teDebenHasta(m)
  };
  // Lo que se tiene menos lo que se debe: la cuenta, los ahorros y lo que le deben,
  // menos el capital pendiente de la tarjeta.
  r.patrimonio = r.saldo + r.ahorroTotal + r.teDeben - r.deudaTarjeta;
  cacheResumen.set(m, r);
  return r;
}

/* --------------------------------------------------------------- render */
function render() {
  cacheResumen.clear();
  cachePlanes.clear();
  const c = resumenMes(mes);

  $("saldo").textContent = cop(c.saldo);
  $("saldo").classList.toggle("neg", c.saldo < 0);
  $("miniInicial").textContent = cop(c.inicial);
  $("libre").textContent = cop(c.libre);
  $("libre").style.color = c.libre < 0 ? "var(--vino)" : "";
  $("comprometido").textContent = cop(c.pendiente);
  $("ingresos").textContent = cop(c.ingresos);
  $("ahorro").textContent = cop(c.ahorroTotal);
  $("miniDeudaCaja").hidden = !c.deudaTarjeta;
  $("miniDeuda").textContent = cop(c.deudaTarjeta);
  $("miniDeudaCaja").title = "Capital que sigue debiendo en la tarjeta, sin contar intereses futuros.";
  $("miniTeDebenCaja").hidden = !c.teDeben;
  $("miniTeDeben").textContent = cop(c.teDeben);
  $("notaSaldo").textContent = c.libre < 0
    ? "Lo que queda no alcanza para lo que falta pagar. Diferencia de " + cop(Math.abs(c.libre)) + "."
    : "Saldo del mes. Ya descontando lo que falta pagar, le quedan " + cop(c.libre) + ".";

  renderBarra(c);

  $("selMes").value = mes;
  $("mesNombre").textContent = nombreMes(mes);
  $("mesNota").textContent = mes === mesDe(hoy()) ? "Mes en curso" : "Cierra en " + cop(c.saldo);
  $("hoyTxt").textContent = diaCorto(diaDentroDe(mes));

  $("porRecibir").textContent = cop(c.porRecibir);
  $("porRecibir").title = "Previsión del sueldo que aún no ha entrado. No cuenta en el saldo.";

  renderInicial(c);
  renderSueldos(c);
  renderFijos(c);
  renderTarjeta();
  renderPrestamos();
  renderAhorros(c);
  renderIngresos();
  const pares = renderCategorias();
  const eventos = eventosDelMes();
  const agenda = venideros();
  renderMovimientos(eventos);
  renderCalendario(agenda);
  renderPortada(c, eventos, agenda[0].items);
  renderHistoria();
  renderPresupuesto();
  renderRevisar();
  renderKpis(c, pares);
  renderAvisos();
  renderGraficos(pares);
  renderAnalisis();
}

/* ------------------------------------------------------------- secciones */
const VISTAS = ["resumen", "movimientos", "fijos", "tarjeta", "prestamos", "ahorros", "historia", "asistente", "ajustes"];

function irAVista(vista, sinSubir) {
  if (!VISTAS.includes(vista)) vista = "resumen";
  document.body.dataset.vista = vista;
  [...$("nav").children].forEach(b => b.classList.toggle("activo", b.dataset.ir === vista));
  try { localStorage.setItem("vista", vista); } catch (e) { /* es solo una comodidad */ }
  history.replaceState(null, "", "#" + vista);
  if (!sinSubir) window.scrollTo({ top: 0 });
  // Los gráficos miden su contenedor, así que se dibujan cuando su sección está a la vista.
  renderGraficos(consumoPorCategoria(mes).pares);
  mostrarGuiaVista(vista);
}

function cambiarTema() {
  const raiz = document.documentElement;
  raiz.dataset.theme = raiz.dataset.theme === "light" ? "dark" : "light";
  try { localStorage.setItem("tema-resumen", raiz.dataset.theme); } catch (e) { /* idem */ }
  sincronizarMarco();
}

function sincronizarMarco() {
  window.pywebview?.api?.colorear_marco?.(document.documentElement.dataset.theme === "light")?.catch(() => {});
}
window.addEventListener("pywebviewready", sincronizarMarco);

/** Variación contra el mes anterior, solo si ese mes tiene registros. */
function variacion(id, actual, previo, subirEsBueno, prefijo) {
  const caja = $(id);
  caja.className = "delta";
  if (previo === null || previo === undefined) { caja.textContent = prefijo || ""; return; }
  const dif = actual - previo;
  if (!dif) { caja.textContent = "igual que el mes pasado"; return; }
  const pct = previo ? Math.round(100 * dif / Math.abs(previo)) : null;
  caja.textContent = (dif > 0 ? "▲ " : "▼ ") + (pct !== null && Math.abs(pct) < 1000 ? Math.abs(pct) + "%" : cop(Math.abs(dif)))
    + " vs " + nombreMes(mesAnterior(mes)).split(" ")[0].toLowerCase();
  caja.classList.add((dif > 0) === subirEsBueno ? "bien" : "mal");
}

function renderKpis(c, pares) {
  const ant = mesAnterior(mes);
  const hayAnterior = mesesRegistrados().includes(ant);
  const p = hayAnterior ? resumenMes(ant) : null;
  const consumo = pares.reduce((s, [, v]) => s + v, 0);
  $("kpiConsumo").textContent = cop(consumo);

  $("dInicial").className = "delta";
  $("dInicial").textContent = c.inicialManual ? "escrito a mano" : c.inicialPrevio ? "cierre del mes anterior" : "sin historia previa";
  $("dLibre").className = "delta";
  $("dLibre").textContent = c.porRecibir ? "con el sueldo: " + cop(c.libre + c.porRecibir) : "después de pagar lo pendiente";

  const pendFijos = fijosDe(mes).filter(f => enVigencia(f, mes) && !f.pagado[mes]).length;
  $("dPendiente").className = "delta";
  $("dPendiente").textContent = [pendFijos ? pendFijos + (pendFijos === 1 ? " fijo" : " fijos") : "",
                                 c.tarjetaPend ? "tarjeta " + cop(c.tarjetaPend) : ""].filter(Boolean).join(" · ") || "todo al día";

  // Lo que ya entró es todo lo que sumó a la cuenta, no solo lo anotado como ingreso.
  $("ingresos").textContent = cop(c.entradas);
  variacion("dIngresos", c.entradas, p && p.entradas, true);
  if (c.sueldoEsperado) {
    $("dIngresos").textContent = "sueldo " + copCorto(c.sueldoRecibido) + " de " + copCorto(c.sueldoEsperado);
    $("dIngresos").className = "delta";
  }
  const proxima = sueldosDe(mes).filter(s => enVigencia(s, mes))
    .flatMap(s => cuotasDe(s, mes).filter(q => q.monto > q.recibido).map(q => ({ ...q, s })))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
  $("dPorRecibir").textContent = proxima
    ? (FRECUENCIAS[proxima.s.frecuencia] > 1 ? proxima.etiqueta.toLowerCase() : "sueldo") + " · " + diaCorto(proxima.fecha)
    : c.sueldoEsperado ? "todo recibido" : "sin sueldo configurado";
  const compradas = estado.compras.filter(x => mesDe(x.fecha) === mes);
  const conTarjeta = compradas.reduce((s, x) => s + x.monto, 0);
  $("kpiTarjetaMes").textContent = cop(conTarjeta);
  const ex = estado.tarjeta ? extractoPara(mes) : null, ext = ex ? ex.d : null;
  $("kpiPagoTarjetaCaja").hidden = !ext || (!ext.total && !ext.pago);
  if (ext) {
    $("kpiPagoTarjeta").textContent = cop(ext.pago ? ext.pago.monto : ext.total);
    $("dPagoTarjeta").className = "delta" + (ext.pago ? " bien" : ex.estado === "vencido" ? " mal" : "");
    $("dPagoTarjeta").textContent = ext.pago ? "pagado el " + diaCorto(ext.pago.fecha)
      : (ex.estado === "vencido" ? "venció el " : ex.estado === "en curso" ? "en curso, vence el " : "vence el ")
        + diaCorto(fechaDePago(ex.mes)) + (ext.interes ? " · " + cop(ext.interes) + " de interés" : "");
  }
  $("dTarjetaMes").className = "delta";
  $("dTarjetaMes").textContent = compradas.length
    ? compradas.length + (compradas.length === 1 ? " compra" : " compras") + " · se paga"
      + (estado.tarjeta ? (n => " desde " + nombreMes(n).split(" ")[0].toLowerCase())(compradas.map(x => mesDePago(x.fecha)).sort()[0]) : " en los extractos")
    : "sin compras con tarjeta";
  variacion("dConsumo", consumo, p && consumoPorCategoria(ant).pares.reduce((s, [, v]) => s + v, 0), false);
  variacion("dDeuda", c.deudaTarjeta, p && p.deudaTarjeta, false);
  if (estado.tarjeta && estado.tarjeta.cupo) {
    $("dDeuda").textContent = "disponible " + cop(Math.max(estado.tarjeta.cupo - c.deudaTarjeta, 0));
    $("dDeuda").className = "delta";
  }
  const vencidos = estado.prestamos.filter(x => estadoPrestamo(x).clave === "vencido").length;
  const personas = new Set(estado.prestamos.filter(x => estadoPrestamo(x).pendiente).map(x => x.persona)).size;
  $("dTeDeben").textContent = personas + (personas === 1 ? " persona" : " personas") + (vencidos ? " · " + vencidos + " vencido(s)" : "");
  $("dTeDeben").className = "delta" + (vencidos ? " mal" : "");
  $("kpiPatrimonio").textContent = cop(c.patrimonio);
  variacion("dPatrimonio", c.patrimonio, p && p.patrimonio, true);
  $("dAhorro").className = "delta" + (c.ahorroAbonado ? " bien" : "");
  $("dAhorro").textContent = c.ahorroAbonado ? "+" + cop(c.ahorroAbonado) + " este mes" : "sin abonos este mes";
}

/** Avisos del menú: lo atrasado o por vencer, mirado siempre contra hoy. */
function renderAvisos() {
  const actual = mesDe(hoy()), dia = Number(hoy().slice(8, 10));
  const atrasados = estado.fijos.filter(f => enVigencia(f, actual) && !f.pagado[actual]
                                             && diaHabitual(f) && diaHabitual(f) < dia).length;
  $("avisoFijos").hidden = !atrasados;
  $("avisoFijos").textContent = atrasados;
  $("avisoFijos").title = atrasados + " fijo(s) que ya suelen estar pagos a esta altura del mes";

  const aviso = $("avisoTarjeta");
  aviso.hidden = true;
  const ex = extractoDeHoy();
  if (ex && ex.d.total && !ex.d.pago && ex.estado !== "en curso") {
    const faltan = diasEntre(fechaDePago(ex.mes), hoy());
    if (faltan <= 7) {
      aviso.hidden = false;
      aviso.className = "aviso" + (faltan < 0 ? "" : " suave");
      aviso.textContent = faltan < 0 ? "!" : faltan + "d";
      aviso.title = faltan < 0 ? "El pago de la tarjeta está vencido" : "La tarjeta se paga en " + faltan + " día(s)";
    }
  }

  const vencidos = estado.prestamos.filter(x => estadoPrestamo(x).clave === "vencido").length;
  $("avisoPrestamos").hidden = !vencidos;
  $("avisoPrestamos").textContent = vencidos;
  $("avisoPrestamos").title = vencidos + " préstamo(s) vencido(s)";
}

/* ------------------------------------------------------------- proyección */
/**
 * Saldo estimado de los próximos meses. Arranca del saldo de hoy; al primer mes
 * se le suma lo que falta de este (el sueldo por entrar menos lo pendiente), y
 * cada mes suma el sueldo previsto y resta los fijos, el extracto de la tarjeta y
 * el gasto suelto promedio. Es una guía: no cuenta ahorros (son voluntarios) ni
 * préstamos por cobrar (no son seguros).
 */
function proyectarSaldo(n) {
  const actual = mesDe(hoy());
  const c = resumenMes(actual);
  const base = c.saldo;
  const resto = c.porRecibir - c.pendiente;

  // Gasto suelto: lo anotado como gasto más lo comprado con tarjeta, en los
  // últimos tres meses cerrados con registros.
  const previos = mesesRegistrados().filter(m => m < actual).slice(-3);
  const variable = previos.length
    ? Math.round(previos.reduce((s, m) => s + delMes(m, "gasto")
        + estado.compras.filter(x => x.tipo === "compra" && mesDe(x.fecha) === m).reduce((t, x) => t + x.monto, 0), 0)
      / previos.length)
    : 0;

  let saldo = base;
  const meses = [];
  for (let k = 1; k <= n; k++) {
    const m = mesMas(actual, k);
    const sueldo = estado.sueldos.filter(s => enVigencia(s, m)).reduce((s, x) => s + esperadoDe(x, m), 0);
    const fijos = estado.fijos.filter(f => enVigencia(f, m) && !f.pagado[m]).reduce((s, f) => s + montoVigente(f, m), 0);
    const t = tarjetaDelMes(m);
    const tarjeta = t.pago ? 0 : t.total;
    const arrastre = k === 1 ? resto : 0;
    saldo += arrastre + sueldo - fijos - tarjeta - variable;
    meses.push({ mes: m, saldo: Math.round(saldo), sueldo, fijos, tarjeta, variable, arrastre });
  }
  return { base, resto, variable, meses };
}

/**
 * La barra llega hasta donde llegaría el mes si entrara todo el sueldo previsto.
 * La línea punteada marca hasta dónde llega lo que ya está en la mano, de modo
 * que se lee de un vistazo cómo queda con y sin ese ingreso.
 */
function renderBarra(c) {
  const salido = c.gastado + c.aportes;              // lo que ya salió de la cuenta
  // Lo que falta para la meta de ahorro se dibuja siempre entero: si no cabe en lo
  // libre, la barra se estira, que es justo la señal de que no alcanza para todo.
  const real = Math.max(c.inicial + c.entradas, salido + c.pendiente + c.porAhorrar, 1);
  const base = real + c.porRecibir;
  const pct = v => (100 * Math.max(v, 0) / base) + "%";

  const libreVisible = Math.max(real - salido - c.pendiente - c.porAhorrar, 0);

  $("segGastado").style.width = pct(c.gastado);
  $("segAhorrado").style.width = pct(c.aportes);
  // Fijos y tarjeta van en tramos aparte: así se ve cuánto del pendiente es la tarjeta.
  $("segComprometido").style.width = pct(c.fijosPend);
  $("segTarjeta").style.width = pct(c.tarjetaPend);
  $("segPorAhorrar").style.width = pct(c.porAhorrar);
  $("segLibre").style.width = pct(libreVisible);
  $("segPrevisto").style.width = pct(c.porRecibir);

  $("lgGastado").textContent = "(" + cop(c.gastado) + ")";
  $("lgFijos").textContent = "(" + cop(c.fijosPend) + ")";
  $("lgFijosCaja").hidden = !c.fijosPend && !!c.tarjetaPend;
  $("lgTarjetaCaja").hidden = !c.tarjetaPend;
  $("lgTarjeta").textContent = "(" + cop(c.tarjetaPend) + ")";
  $("lgLibre").textContent = "(" + cop(c.libre) + ")";
  $("lgAhorradoCaja").hidden = !c.aportes;
  $("lgAhorrado").textContent = "(" + cop(c.aportes) + ")";
  $("lgPorAhorrarCaja").hidden = !c.porAhorrar;
  $("lgPorAhorrar").textContent = "(" + cop(c.porAhorrar) + ")";
  $("lgPrevistoCaja").hidden = !c.porRecibir;
  $("lgPrevisto").textContent = "(" + cop(c.porRecibir) + ")";

  const marca = $("marcaHoy");
  marca.hidden = !c.porRecibir;
  if (c.porRecibir) {
    const posicion = 100 * real / base;
    marca.style.left = posicion + "%";
    marca.classList.toggle("derecha", posicion > 78);   // la etiqueta se va hacia dentro
    marca.classList.toggle("izquierda", posicion < 22);
    $("marcaValor").textContent = "sin el sueldo: " + cop(c.libre);
    marca.title = "Hasta aquí llega lo que ya tiene. Lo de la derecha depende de que entre el sueldo.";
  }

  renderEscenarios(c);
}

/** Cómo quedaría el disponible según entre el sueldo, se cumpla la meta de ahorro, o ambas. */
function renderEscenarios(c) {
  const casos = [{ etiqueta: "Libre hoy", valor: c.libre, clase: "hoy" }];
  if (c.porAhorrar) {
    casos.push({ etiqueta: "Si abona el ahorro", valor: c.libre - c.porAhorrar, clase: "ahorro" });
  }
  if (c.porRecibir) {
    casos.push({ etiqueta: "Si entra el sueldo", valor: c.libre + c.porRecibir, clase: "" });
  }
  if (c.porAhorrar && c.porRecibir) {
    casos.push({ etiqueta: "Con sueldo y ahorro", valor: c.libre + c.porRecibir - c.porAhorrar, clase: "" });
  }

  const cont = $("escenarios");
  cont.innerHTML = "";
  cont.hidden = casos.length === 1;
  if (cont.hidden) return;

  casos.forEach(caso => {
    const d = document.createElement("div");
    if (caso.clase) d.className = caso.clase;
    d.innerHTML = "<span></span><b></b>";
    d.querySelector("span").textContent = caso.etiqueta;
    const b = d.querySelector("b");
    b.textContent = cop(caso.valor);
    b.classList.toggle("neg", caso.valor < 0);
    cont.append(d);
  });
}

function renderInicial(c) {
  const inp = $("inpInicial");
  if (document.activeElement !== inp) inp.value = c.inicialManual ? c.inicial : "";
  inp.placeholder = conPuntos(c.inicial);
  $("btnArrastre").disabled = !c.inicialManual;

  if (c.inicialManual) {
    $("inicialOrigen").textContent = "Escrito a mano";
    $("notaInicial").textContent =
      "Este mes arranca con " + cop(c.inicial) + " porque usted lo fijó así. Borre el campo, o use el "
      + "botón, para volver a heredar el cierre del mes anterior.";
  } else if (c.inicialPrevio) {
    $("inicialOrigen").textContent = "Heredado";
    $("notaInicial").textContent =
      "Viene del cierre de " + nombreMes(c.inicialPrevio) + ": " + cop(c.inicial)
      + ". Si el banco dice otra cosa, escriba el monto real aquí y el resto se recalcula.";
  } else {
    $("inicialOrigen").textContent = "Sin historia previa";
    $("notaInicial").textContent =
      "Es el primer mes con registros, así que empieza en cero. Escriba con cuánto arrancó de verdad.";
  }
}

/** Aviso corto si el monto cambió justo en el mes que se mira. */
function cambioReciente(item, m) {
  if (!item.montos || item.montos[m] === undefined) return "";
  const anterior = montoVigente(item, mesAnterior(m));
  if (anterior === item.montos[m]) return "";
  return (item.montos[m] > anterior ? "subió desde " : "bajó desde ") + cop(anterior);
}

/**
 * El pago de la tarjeta no es un fijo: lo calcula la app con las cuotas, intereses y
 * manejo. Igual se muestra aquí arriba, porque es otro pago del mes que hay que hacer.
 */
function renderFilaPagoTarjeta() {
  const caja = $("filaPagoTarjeta");
  caja.innerHTML = "";
  if (!estado.tarjeta) return;
  const ex = extractoPara(mes), t = ex.d;
  if (!t.total && !t.pago) return;
  const fila = document.createElement("div");
  fila.className = "fila fila-tarjeta" + (t.pago ? " pagado" : "");
  const marca = document.createElement("span");
  marca.className = "badge tarjeta";
  marca.textContent = "Tarjeta";
  const detalle = t.pago ? "pagado el " + diaCorto(t.pago.fecha)
    : (ex.estado === "vencido" ? "venció el " : "vence el ") + diaCorto(fechaDePago(ex.mes))
      + (ex.estado === "en curso" ? " (aún no corta)" : "") + " · " + t.cuotas.length + " cuota(s), intereses y manejo · lo calcula la app";
  const ver = document.createElement("button");
  ver.className = t.pago ? "ghost" : "";
  ver.textContent = t.pago ? "Ver" : "Registrar pago";
  ver.onclick = () => { if (!t.pago) pagandoTarjeta = true; irAVista("tarjeta"); render(); };
  fila.append(marca, textoFila("Pago de " + estado.tarjeta.nombre, detalle),
              valorFila(cop(t.pago ? t.pago.monto : t.total)), ver);
  caja.append(fila);
}

function renderFijos(c) {
  renderFilaPagoTarjeta();
  const cont = $("listaFijos");
  cont.innerHTML = "";
  const lista = fijosDe(mes);

  if (!lista.length) {
    cont.innerHTML = '<div class="vacio">Todavía no hay gastos fijos en este mes. Agregue el arriendo, los servicios o la cuota de la tarjeta aquí abajo.</div>';
  }

  lista.forEach(f => {
    if (editando === f.id) { cont.append(formularioEdicion(f, false)); return; }

    const fila = document.createElement("div");
    fila.className = "fila" + (f.pagado[mes] ? " pagado" : "");

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !!f.pagado[mes];
    chk.setAttribute("aria-label", "Marcar " + f.concepto + " como pagado");
    chk.onchange = () => {
      if (chk.checked) f.pagado[mes] = diaDentroDe(mes); else delete f.pagado[mes];
      render(); guardar();
    };

    const detalle = [f.categoria];
    if (f.pagado[mes]) detalle.push("pagado el " + diaCorto(f.pagado[mes]));
    if (!enVigencia(f, mes)) detalle.push("terminado");
    else if (f.hasta === mes) detalle.push(f.desde === mes ? "solo este mes" : "último mes");
    const cambio = cambioReciente(f, mes);
    if (cambio) detalle.push(cambio);

    const editar = document.createElement("button");
    editar.className = "ghost";
    editar.textContent = "Editar";
    editar.onclick = () => { editando = f.id; render(); };

    fila.append(chk, textoFila(f.concepto, detalle.join(" · ")),
                valorFila(cop(montoVigente(f, mes))), editar);
    cont.append(fila);
  });

  renderTerminados();
  $("fijosResumen").textContent = cop(c.fijosPagados) + " de " + cop(c.fijosPagados + c.fijosPend);
}

function textoFila(titulo, detalle) {
  const txt = document.createElement("div");
  txt.className = "txt";
  txt.innerHTML = "<b></b><small></small>";
  txt.querySelector("b").textContent = titulo;
  txt.querySelector("small").textContent = detalle;
  return txt;
}

function valorFila(texto, clase) {
  const val = document.createElement("div");
  val.className = "val" + (clase ? " " + clase : "");
  val.textContent = texto;
  return val;
}

function renderAhorros(c) {
  const cont = $("listaAhorros");
  cont.innerHTML = "";
  const lista = ahorrosDe(mes);

  if (!lista.length) {
    cont.innerHTML = '<div class="vacio">Sin ahorros todavía. Cree uno con nombre —"Viaje", "Fondo de emergencia"— y el acumulado se conserva mes a mes.</div>';
  }

  lista.forEach(a => {
    if (editando === a.id) { cont.append(formularioEdicion(a, true)); return; }

    const acumulado = acumuladoAhorro(a, mes);
    const abonado = abonadoEnMes(a, mes);
    const meta = montoVigente(a, mes);

    const caja = document.createElement("div");
    caja.className = "ahorro" + (meta && abonado >= meta ? " hecho" : "");

    const fila = document.createElement("div");
    fila.className = "fila";

    const detalle = [];
    detalle.push(abonado ? "abonó " + cop(abonado) + " este mes" : "sin abonos este mes");
    if (meta) detalle.push("meta de " + cop(meta));
    if (a.inicial) detalle.push("arrancó con " + cop(a.inicial));
    if (!enVigencia(a, mes)) detalle.push("archivado");
    const cambio = cambioReciente(a, mes);
    if (cambio) detalle.push("meta " + cambio);

    const abonar = document.createElement("button");
    abonar.className = accion.id === a.id && accion.tipo === "aporte" ? "" : "primario";
    abonar.textContent = accion.id === a.id && accion.tipo === "aporte" ? "Cancelar" : "Abonar";
    abonar.onclick = () => cambiarAccion(a.id, "aporte");

    const retirar = document.createElement("button");
    retirar.className = "ghost";
    retirar.textContent = accion.id === a.id && accion.tipo === "retiro" ? "Cancelar" : "Retirar";
    retirar.onclick = () => cambiarAccion(a.id, "retiro");

    const editar = document.createElement("button");
    editar.className = "ghost";
    editar.textContent = "Editar";
    editar.onclick = () => { editando = a.id; accion = {}; render(); };

    fila.append(textoFila(a.concepto, detalle.join(" · ")),
                valorFila(cop(acumulado), "entrada"), abonar, retirar, editar);
    caja.append(fila);

    if (accion.id === a.id) caja.append(formularioAhorro(a, acumulado, meta, abonado));

    if (a.objetivo > 0) {
      const barra = document.createElement("div");
      barra.className = "meta";
      const pct = Math.max(0, Math.min(100, 100 * acumulado / a.objetivo));
      barra.innerHTML = '<div class="track"><i></i></div><small></small>';
      barra.querySelector("i").style.width = pct + "%";
      barra.querySelector("small").textContent =
        Math.round(pct) + "% de " + cop(a.objetivo) +
        (acumulado < a.objetivo ? " · faltan " + cop(a.objetivo - acumulado) : " · meta cumplida");
      caja.append(barra);
    }

    cont.append(caja);
  });

  $("ahorrosResumen").textContent = cop(c.ahorroTotal);
  $("ahorroNota").textContent = c.metaAhorro
    ? "Abonado este mes " + cop(c.ahorroAbonado) + " de una meta de " + cop(c.metaAhorro)
      + ". El ahorro es voluntario: lo que falte para la meta no se descuenta del disponible."
    : "El ahorro es voluntario: abone lo que quiera y cuando quiera.";
}

function cambiarAccion(id, tipo) {
  accion = (accion.id === id && accion.tipo === tipo) ? {} : { id, tipo };
  render();
}

/**
 * Abonar o retirar de un bolsillo. El monto es libre: la meta mensual solo
 * sirve para proponer un valor, se puede abonar menos o más.
 */
function formularioAhorro(a, acumulado, meta, abonado) {
  const esAporte = accion.tipo === "aporte";
  const caja = document.createElement("div");
  caja.className = "retiro";
  caja.innerHTML = `
    <div><label>${esAporte ? "Cuánto abona" : "Cuánto retira"}</label>
      <input class="rMonto" type="number" min="0" step="10000"></div>
    <div><label>Nota</label><input class="rDesc"></div>
    <div><label>Fecha</label><input class="rFecha" type="date"></div>
    <button class="primario rOk">${esAporte ? "Abonar" : "Retirar"}</button>
    <small></small>`;

  const monto = caja.querySelector(".rMonto");
  const desc = caja.querySelector(".rDesc");
  const fecha = caja.querySelector(".rFecha");

  fecha.value = diaDentroDe(mes);
  desc.placeholder = (esAporte ? "Abono a " : "Retiro de ") + a.concepto;

  if (esAporte) {
    const sugerido = Math.max(meta - abonado, 0);
    if (sugerido) monto.value = sugerido;
    caja.querySelector("small").textContent = meta
      ? "La meta del mes es " + cop(meta) + " y lleva " + cop(abonado) + ". Puede abonar menos o más."
      : "Sin meta mensual: abone lo que quiera.";
  } else {
    caja.querySelector("small").textContent = "Tiene " + cop(acumulado) + " en este ahorro.";
  }

  const confirmar = () => {
    const valor = Number(monto.value);
    if (!valor || valor <= 0) { monto.focus(); return; }
    estado.movimientos.push({
      id: uid(), fecha: fecha.value || diaDentroDe(mes), tipo: accion.tipo,
      concepto: desc.value.trim() || desc.placeholder,
      categoria: "Otros", monto: valor, ahorro: a.id
    });
    accion = {};
    render(); guardar();
  };
  caja.querySelector(".rOk").onclick = confirmar;
  [monto, desc].forEach(e => e.addEventListener("keydown", ev => { if (ev.key === "Enter") confirmar(); }));
  return caja;
}

/**
 * Formulario de edición compartido por gastos fijos y ahorros: cambiar el monto
 * desde este mes deja intactos los meses anteriores, que es lo que preserva la historia.
 */
function formularioEdicion(item, esAhorro, esSueldo) {
  const etiquetaMonto = esAhorro ? "Meta mensual" : esSueldo ? "Monto por pago" : "Monto";
  const etiquetaNombre = esAhorro ? "Nombre del ahorro" : esSueldo ? "Nombre" : "Concepto";
  const caja = document.createElement("div");
  caja.className = "edicion";
  caja.innerHTML = `
    <div class="edicion-campos">
      <div><label>${etiquetaNombre}</label><input class="eConcepto"></div>
      <div class="eSegundo"></div>
      <div class="eTercero" hidden></div>
      <div><label>${etiquetaMonto}</label><input class="eMonto" type="number" min="0" step="1000"></div>
      <div><label>Aplicar</label><select class="eAlcance">
        <option value="desde">Desde este mes en adelante</option>
        <option value="todo">Corregir en toda la historia</option>
      </select></div>
    </div>
    <div class="edicion-botones">
      <button class="primario eGuardar">Guardar</button>
      <button class="eCancelar">Cancelar</button>
      <span class="separador"></span>
      <button class="ghost eTerminar">${esAhorro ? "Archivar" : esSueldo ? "Ya no recibo este sueldo" : "Quitarlo ya, desde este mes"}</button>
      <button class="ghost peligro eBorrar">Borrar de la historia</button>
    </div>
    <p class="nota eNota"></p>`;

  const cCon = caja.querySelector(".eConcepto");
  const cMonto = caja.querySelector(".eMonto");
  const cAlcance = caja.querySelector(".eAlcance");
  const segundo = caja.querySelector(".eSegundo");

  const tercero = caja.querySelector(".eTercero");

  let cCat = null, cObjetivo = null, cInicial = null, cFrec = null, cRepite = null;
  if (esAhorro) {
    segundo.innerHTML = '<label>Meta (opcional)</label><input class="eObjetivo" type="number" min="0" step="10000">';
    cObjetivo = segundo.querySelector(".eObjetivo");
    cObjetivo.value = item.objetivo || "";

    tercero.hidden = false;
    tercero.innerHTML = '<label>Ahorro inicial</label><input class="eInicial" type="number" step="10000">';
    cInicial = tercero.querySelector(".eInicial");
    cInicial.value = item.inicial || "";
  } else if (esSueldo) {
    segundo.innerHTML = `<label>Cada cuánto</label><select class="eFrec">
      <option value="mensual">Mensual</option>
      <option value="quincenal">Quincenal</option>
      <option value="semanal">Semanal</option></select>`;
    cFrec = segundo.querySelector(".eFrec");
    cFrec.value = item.frecuencia;
  } else {
    segundo.innerHTML = "<label>Categoría</label><select class='eCat'></select>";
    cCat = segundo.querySelector(".eCat");
    llenarOpciones(cCat, CATEGORIAS);
    cCat.value = item.categoria;

    tercero.hidden = false;
    tercero.innerHTML = `<label>Repetición</label><select class="eRepite">
      <option value="cada">Sigue todos los meses</option>
      <option value="ultimo">Termina este mes</option>
      <option value="unico">Solo este mes</option></select>`;
    cRepite = tercero.querySelector(".eRepite");
    cRepite.value = item.hasta !== mes ? "cada" : (item.desde === mes ? "unico" : "ultimo");
  }

  cCon.value = item.concepto;
  cMonto.value = montoVigente(item, mes);

  const nota = caja.querySelector(".eNota");
  const refrescarNota = () => {
    const partes = [cAlcance.value === "desde"
      ? "Los meses anteriores conservan el monto que tenían. Útil cuando la cuota de la tarjeta sube, entran cuotas nuevas o quiere ahorrar más."
      : "Cambia el monto en todos los meses, incluso los ya cerrados. Úselo solo para corregir un error de captura."];
    if (cRepite) partes.push({
      cada: "Seguirá apareciendo cada mes.",
      ultimo: "Aparece en " + nombreMes(mes) + " y desde el mes siguiente ya no. Lo que haya pagado antes se conserva intacto.",
      unico: "Queda solo en " + nombreMes(mes) + ", como una deuda puntual."
    }[cRepite.value]);
    nota.textContent = partes.join(" ");
  };
  cAlcance.onchange = refrescarNota;
  if (cRepite) cRepite.onchange = refrescarNota;
  refrescarNota();

  caja.querySelector(".eGuardar").onclick = () => {
    const concepto = cCon.value.trim();
    const monto = Number(cMonto.value);
    if (!concepto || monto < 0 || Number.isNaN(monto)) { cCon.focus(); return; }
    item.concepto = concepto;
    if (cCat) item.categoria = cCat.value;
    if (cObjetivo) item.objetivo = Number(cObjetivo.value) || 0;
    if (cInicial) item.inicial = Number(cInicial.value) || 0;
    if (cFrec) item.frecuencia = cFrec.value;
    if (cRepite) {
      // Acotar la vigencia nunca borra lo ya pagado: el historial se calcula sobre
      // lo marcado mes a mes, no sobre si el gasto sigue vigente hoy.
      if (cRepite.value === "unico") { item.desde = mes; item.hasta = mes; }
      else if (cRepite.value === "ultimo") item.hasta = mes;
      else if (item.hasta) item.hasta = null;
    }
    if (cAlcance.value === "todo") {
      item.monto = monto;
      item.montos = {};
    } else {
      item.montos[mes] = monto;
      if (montoVigente(item, mesAnterior(mes)) === monto) delete item.montos[mes];
    }
    editando = null;
    render(); guardar();
  };

  caja.querySelector(".eCancelar").onclick = () => { editando = null; render(); };

  caja.querySelector(".eTerminar").onclick = () => {
    // Si ya está marcado en este mes no se puede sacar de él sin falsear la historia:
    // lo más lejos que llega es dejar este mes como el último.
    const usadoEsteMes = esAhorro ? abonadoEnMes(item, mes)
                       : esSueldo ? recibidoDe(item, mes) : item.pagado[mes];
    if (usadoEsteMes && !esAhorro && !esSueldo) {
      alert(`"${item.concepto}" ya está pagado en ${nombreMes(mes)}, así que no se puede quitar `
            + "de este mes sin desmarcarlo primero. Queda como su último mes: desde el siguiente ya no aparece.");
    }
    item.hasta = usadoEsteMes ? mes : mesAnterior(mes);
    editando = null;
    render(); guardar();
  };

  caja.querySelector(".eBorrar").onclick = () => {
    let aviso = `¿Borrar "${item.concepto}"?`;
    if (esAhorro) {
      const movs = estado.movimientos.filter(m => m.ahorro === item.id).length;
      if (movs) aviso = `"${item.concepto}" tiene ${movs} movimiento(s) asociados. Se conservan como aportes y retiros sueltos. ¿Continuar?`;
    } else if (esSueldo) {
      const movs = estado.movimientos.filter(m => m.sueldo === item.id).length;
      if (movs) aviso = `"${item.concepto}" tiene ${movs} pago(s) registrados. Los ingresos se conservan; solo se pierde la previsión. ¿Continuar?`;
    } else {
      const marcas = Object.keys(item.pagado).length;
      if (marcas) {
        aviso = `"${item.concepto}" tiene ${marcas} mes(es) pagados y borrarlo revierte esos pagos, `
              + `así que el saldo de esos meses cambiará.\n\nSi lo que quiere es que deje de aparecer `
              + `sin tocar el pasado, cancele y use la casilla Repetición: "Termina este mes".\n\n¿Borrar de todos modos?`;
      }
    }
    if (!confirm(aviso)) return;
    if (esAhorro) {
      estado.ahorros = estado.ahorros.filter(x => x.id !== item.id);
      estado.movimientos.forEach(m => { if (m.ahorro === item.id) m.ahorro = null; });
    } else if (esSueldo) {
      estado.sueldos = estado.sueldos.filter(x => x.id !== item.id);
      estado.movimientos.forEach(m => {
        if (m.sueldo === item.id) { m.sueldo = null; m.cuota = null; }
      });
    } else {
      estado.fijos = estado.fijos.filter(x => x.id !== item.id);
    }
    editando = null;
    render(); guardar();
  };

  return caja;
}

function renderTerminados() {
  const cont = $("terminadosCaja");
  cont.innerHTML = "";
  const fuera = estado.fijos.filter(f => !enVigencia(f, mes) && !f.pagado[mes]);
  if (!fuera.length) return;

  const btn = document.createElement("button");
  btn.className = "ghost";
  btn.textContent = (verTerminados ? "Ocultar" : "Ver") + " " + fuera.length + " fijo(s) fuera de este mes";
  btn.onclick = () => { verTerminados = !verTerminados; render(); };
  cont.append(btn);

  if (!verTerminados) return;
  fuera.forEach(f => {
    const fila = document.createElement("div");
    fila.className = "fila tenue";

    const nota = f.hasta && mes > f.hasta
      ? "Terminó en " + nombreMes(f.hasta)
      : "Empieza en " + nombreMes(f.desde || mes);

    const revivir = document.createElement("button");
    revivir.className = "ghost";
    revivir.textContent = "Reactivar aquí";
    revivir.onclick = () => {
      if (f.hasta && mes > f.hasta) f.hasta = null;
      if (f.desde && mes < f.desde) f.desde = mes;
      render(); guardar();
    };

    fila.append(textoFila(f.concepto, nota), valorFila(cop(montoVigente(f, mes))), revivir);
    cont.append(fila);
  });
}

function renderSueldos(c) {
  const cont = $("listaSueldos");
  cont.innerHTML = "";
  const lista = sueldosDe(mes);

  if (!lista.length) {
    cont.innerHTML = '<div class="vacio">Sin sueldo configurado. Anótelo abajo para tener la previsión del mes; seguirá haciendo falta registrar cada pago cuando entre.</div>';
  }

  lista.forEach(s => {
    if (editando === s.id) { cont.append(formularioEdicion(s, false, true)); return; }

    const caja = document.createElement("div");
    caja.className = "sueldo";

    const cabecera = document.createElement("div");
    cabecera.className = "fila";

    const recibido = recibidoDe(s, mes);
    const esperado = esperadoDe(s, mes);
    const detalle = [{ mensual: "una vez al mes", quincenal: "por quincena", semanal: "por semana" }[s.frecuencia]
                     + " · " + cop(montoVigente(s, mes))];
    if (!enVigencia(s, mes)) detalle.push("ya no rige");
    const cambio = cambioReciente(s, mes);
    if (cambio) detalle.push(cambio);

    const editar = document.createElement("button");
    editar.className = "ghost";
    editar.textContent = "Editar";
    editar.onclick = () => { editando = s.id; accion = {}; render(); };

    cabecera.append(textoFila(s.concepto, detalle.join(" · ")),
                    valorFila(cop(recibido) + " de " + cop(esperado)), editar);
    caja.append(cabecera);

    cuotasDe(s, mes).forEach(q => {
      const falta = Math.max(q.monto - q.recibido, 0);
      const fila = document.createElement("div");
      fila.className = "cuota" + (falta ? "" : " lista");

      const marca = document.createElement("span");
      marca.className = "badge " + (falta ? "" : "in");
      marca.textContent = falta ? "Previsto" : "Recibido";

      const estado = q.recibido
        ? (falta ? "lleva " + cop(q.recibido) + ", faltan " + cop(falta) : "completo")
        : "esperado el " + diaCorto(q.fecha);

      const registrar = document.createElement("button");
      const abierto = accion.id === s.id && accion.cuota === q.indice;
      registrar.className = abierto ? "" : (falta ? "primario" : "ghost");
      registrar.textContent = abierto ? "Cancelar" : (falta ? "Registrar" : "Agregar más");
      registrar.onclick = () => {
        accion = abierto ? {} : { id: s.id, tipo: "sueldo", cuota: q.indice };
        render();
      };

      fila.append(marca, textoFila(q.etiqueta, estado), valorFila(cop(q.monto)), registrar);
      caja.append(fila);

      if (abierto) caja.append(formularioSueldo(s, q, falta));
    });

    cont.append(caja);
  });

  $("sueldoResumen").textContent = c.sueldoEsperado ? cop(c.sueldoEsperado) : "";
  $("sueldoNota").textContent = c.sueldoEsperado
    ? "Es una previsión: de los " + cop(c.sueldoEsperado) + " ha entrado " + cop(c.sueldoRecibido)
      + ". Solo lo registrado cuenta en el saldo, así que si deja el trabajo basta con no registrarlo."
    : "";
}

/** Registrar un pago real del sueldo: puede ser el monto completo o una parte. */
function formularioSueldo(s, cuota, falta) {
  const caja = document.createElement("div");
  caja.className = "retiro";
  caja.innerHTML = `
    <div><label>Cuánto le entró</label><input class="rMonto" type="number" min="0" step="10000"></div>
    <div><label>Nota</label><input class="rDesc"></div>
    <div><label>Fecha</label><input class="rFecha" type="date"></div>
    <button class="primario rOk">Registrar ingreso</button>
    <small></small>`;

  const monto = caja.querySelector(".rMonto");
  const desc = caja.querySelector(".rDesc");
  const fecha = caja.querySelector(".rFecha");

  monto.value = falta || cuota.monto;
  desc.placeholder = s.concepto + " · " + cuota.etiqueta;
  fecha.value = mesDe(hoy()) === mes ? hoy() : cuota.fecha;
  caja.querySelector("small").textContent = falta
    ? "Si le pagaron solo una parte, escriba lo que entró de verdad."
    : "Esta cuota ya está completa; lo que registre se suma encima.";

  const confirmar = () => {
    const valor = Number(monto.value);
    if (!valor || valor <= 0) { monto.focus(); return; }
    estado.movimientos.push({
      id: uid(), fecha: fecha.value || cuota.fecha, tipo: "ingreso",
      concepto: desc.value.trim() || desc.placeholder,
      categoria: "Sueldo", monto: valor, ahorro: null,
      sueldo: s.id, cuota: cuota.indice
    });
    accion = {};
    render(); guardar();
  };
  caja.querySelector(".rOk").onclick = confirmar;
  [monto, desc].forEach(e => e.addEventListener("keydown", ev => { if (ev.key === "Enter") confirmar(); }));
  return caja;
}

function renderIngresos() {
  const cont = $("listaIngresos");
  cont.innerHTML = "";
  const lista = estado.movimientos
    .filter(m => mesDe(m.fecha) === mes && m.tipo === "ingreso")
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id));

  if (!lista.length) {
    cont.innerHTML = '<div class="vacio">Sin ingresos anotados este mes. Anote el sueldo, un regalo o cualquier entrada de plata.</div>';
  }

  let total = 0;
  lista.forEach(m => {
    total += m.monto;
    if (editandoMov === m.id && editandoMovEn === "ingresos") { cont.append(formularioMovimiento(m)); return; }
    const fila = document.createElement("div");
    fila.className = "fila";

    const editar = document.createElement("button");
    editar.className = "ghost";
    editar.textContent = "Editar";
    editar.onclick = () => { editandoMov = m.id; editandoMovEn = "ingresos"; render(); };

    const borrar = document.createElement("button");
    borrar.className = "ghost";
    borrar.textContent = "Borrar";
    borrar.onclick = () => {
      estado.movimientos = estado.movimientos.filter(x => x.id !== m.id);
      render(); guardar();
    };

    fila.append(textoFila(m.concepto || m.categoria, diaCorto(m.fecha) + " · " + m.categoria),
                valorFila("+" + cop(m.monto), "entrada"), editar, borrar);
    cont.append(fila);
  });
  $("ingresosResumen").textContent = cop(total);
}

/**
 * Consumo del mes por categoría. Lo comprado con tarjeta cuenta en el mes en que
 * se compró; del extracto solo se suma lo que cuesta la tarjeta, para no contar
 * dos veces lo mismo.
 */
function consumoPorCategoria(m) {
  const acum = {};
  estado.movimientos
    .filter(x => mesDe(x.fecha) === m && x.tipo === "gasto")
    .forEach(x => acum[x.categoria] = (acum[x.categoria] || 0) + x.monto);
  fijosDe(m)
    .filter(f => f.pagado[m])
    .forEach(f => acum[f.categoria] = (acum[f.categoria] || 0) + montoVigente(f, m));
  let conTarjeta = 0;
  estado.compras
    .filter(x => mesDe(x.fecha) === m && x.tipo === "compra")
    .forEach(x => { acum[x.categoria] = (acum[x.categoria] || 0) + x.monto; conTarjeta += x.monto; });
  const t = tarjetaDelMes(m);
  const costo = t.interes + t.manejo + t.comisiones;
  if (costo) acum["Costo de la tarjeta"] = costo;
  return { pares: Object.entries(acum).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), conTarjeta };
}

/** La lista de categorías es también la leyenda y la tabla de la dona. */
function renderCategorias() {
  const { pares, conTarjeta } = consumoPorCategoria(mes);
  const total = pares.reduce((s, [, v]) => s + v, 0);
  const cont = $("listaCats");
  cont.innerHTML = "";
  if (!pares.length) cont.innerHTML = '<div class="vacio">Sin gastos registrados este mes.</div>';
  pares.forEach(([k, v]) => {
    const d = document.createElement("div");
    d.className = "cat";
    d.innerHTML = "<i></i><span></span><b></b><small></small>";
    d.querySelector("i").style.background = colorCat(k);
    d.querySelector("span").textContent = k;
    d.querySelector("b").textContent = cop(v);
    d.querySelector("small").textContent = Math.round(100 * v / total) + "%";
    cont.append(d);
  });
  $("totalCats").textContent = cop(total);
  $("notaCats").hidden = !conTarjeta;
  $("notaCats").textContent = "Incluye " + cop(conTarjeta) + " comprados con tarjeta este mes, que se pagan en los extractos.";
  return pares;
}

/** Movimientos sueltos del mes más los pagos de fijos y los aportes de ahorro. */
function eventosDelMes() {
  const sueltos = estado.movimientos
    .filter(m => mesDe(m.fecha) === mes)
    .map(m => ({ ...m, origen: "mov" }));

  const pagos = fijosDe(mes)
    .filter(f => f.pagado[mes])
    .map(f => ({
      id: "fijo:" + f.id, fecha: f.pagado[mes], tipo: "gasto", origen: "fijo", ref: f,
      concepto: f.concepto, categoria: f.categoria, monto: montoVigente(f, mes)
    }));

  const tarjeta = [];
  if (estado.tarjeta) Object.entries(estado.tarjeta.pagos).filter(([, p]) => mesDe(p.fecha) === mes).forEach(([mExt, p]) => tarjeta.push({
    id: "tarjeta:" + mExt, fecha: p.fecha, tipo: "gasto", origen: "pagoTarjeta",
    concepto: "Pago de " + estado.tarjeta.nombre + " (vence " + diaCorto(fechaDePago(mExt)) + ")", categoria: "Deudas", monto: p.monto
  }));
  estado.compras.filter(x => mesDe(x.fecha) === mes).forEach(x => tarjeta.push({
    id: "compra:" + x.id, fecha: x.fecha, tipo: x.tipo === "avance" ? "ingreso" : "compra",
    origen: x.tipo === "avance" ? "avance" : "compra", ref: x,
    concepto: x.concepto || (x.tipo === "avance" ? "Avance a la cuenta" : "Compra con tarjeta"),
    categoria: x.categoria, monto: x.monto
  }));

  const prestamos = [];
  estado.prestamos.forEach(p => {
    if (mesDe(p.fecha) === mes) prestamos.push({
      id: "prestamo:" + p.id, fecha: p.fecha, tipo: "gasto", origen: "prestamo", ref: p,
      concepto: "Préstamo a " + p.persona + (p.concepto ? " · " + p.concepto : ""), categoria: "", monto: p.monto
    });
    p.abonos.filter(a => mesDe(a.fecha) === mes).forEach(a => prestamos.push({
      id: "abono:" + a.id, fecha: a.fecha, tipo: "ingreso", origen: "abono", ref: p,
      concepto: p.persona + " devolvió" + (a.nota ? " · " + a.nota : ""), categoria: "", monto: a.monto
    }));
  });

  return [...sueltos, ...pagos, ...tarjeta, ...prestamos]
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.id).localeCompare(String(a.id)));
}

/**
 * Editar un gasto, ingreso, aporte o retiro. Si la fecha cambia de mes, la app se va
 * a ese mes para que se vea dónde quedó. Un ingreso vinculado a un sueldo conserva
 * el vínculo mientras siga siendo ingreso.
 */
function formularioMovimiento(m) {
  const caja = document.createElement("div");
  caja.className = "edicion edicion-mov";
  caja.innerHTML = `
    <div class="edicion-campos">
      <div><label>Tipo</label><select class="eTipo">
        <option value="gasto">Salida · Gasto</option>
        <option value="ingreso">Entrada · Ingreso</option>
        <option value="aporte">Salida · Aporte a ahorro</option>
        <option value="retiro">Entrada · Retiro de ahorro</option></select></div>
      <div><label>Qué fue</label><input class="eConcepto"></div>
      <div class="eCampoCat"><label>Categoría</label><select class="eCat"></select></div>
      <div class="eCampoAhorro"><label>Bolsillo</label><select class="eAhorro"></select></div>
      <div><label>Monto</label><input class="eMonto" type="number" min="0" step="1000"></div>
      <div><label>Fecha</label><input class="eFecha" type="date"></div>
    </div>
    <div class="edicion-botones">
      <button class="primario eGuardar">Guardar</button>
      <button class="eCancelar">Cancelar</button>
      <span class="separador"></span>
      <button class="ghost peligro eBorrar">Borrar</button>
    </div>
    <p class="nota eNota"></p>`;
  const q = sel => caja.querySelector(sel);
  q(".eTipo").value = m.tipo;
  q(".eConcepto").value = m.concepto;
  q(".eMonto").value = m.monto;
  q(".eFecha").value = m.fecha;
  q(".eAhorro").add(new Option("Sin bolsillo", ""));
  estado.ahorros.forEach(a => q(".eAhorro").add(new Option(a.concepto, a.id)));
  q(".eAhorro").value = m.ahorro || "";

  const ajustar = () => {
    const tipo = q(".eTipo").value, esAhorro = tipo === "aporte" || tipo === "retiro";
    const lista = tipo === "ingreso" ? ORIGENES : CATEGORIAS;
    const previo = q(".eCat").value || m.categoria;
    q(".eCat").innerHTML = "";
    llenarOpciones(q(".eCat"), lista);
    q(".eCat").value = lista.includes(previo) ? previo : lista.includes(m.categoria) ? m.categoria : "Otros";
    q(".eCampoCat").hidden = esAhorro;
    q(".eCampoAhorro").hidden = !esAhorro;
    q(".eNota").textContent = m.sueldo && tipo === "ingreso"
      ? "Es un pago de " + nombreSueldo(m.sueldo) + ": sigue contando para ese sueldo."
      : m.sueldo ? "Dejará de contar como pago de " + nombreSueldo(m.sueldo) + "." : "";
  };
  q(".eTipo").onchange = ajustar;
  ajustar();

  const guardarCambios = () => {
    const monto = Number(q(".eMonto").value), fecha = q(".eFecha").value, tipo = q(".eTipo").value;
    if (!monto || monto <= 0) { q(".eMonto").focus(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { q(".eFecha").focus(); return; }
    const esAhorro = tipo === "aporte" || tipo === "retiro";
    Object.assign(m, {
      tipo, fecha, monto: Math.round(monto), concepto: q(".eConcepto").value.trim(),
      categoria: esAhorro ? "Otros" : q(".eCat").value,
      ahorro: esAhorro ? (q(".eAhorro").value || null) : null
    });
    if (tipo !== "ingreso") { m.sueldo = null; m.cuota = null; }
    editandoMov = null;
    if (mesDe(fecha) !== mes) irAMes(mesDe(fecha)); else render();
    guardar();
  };
  q(".eGuardar").onclick = guardarCambios;
  [".eConcepto", ".eMonto"].forEach(sel =>
    q(sel).addEventListener("keydown", e => { if (e.key === "Enter") guardarCambios(); }));
  q(".eCancelar").onclick = () => { editandoMov = null; render(); };
  q(".eBorrar").onclick = () => {
    estado.movimientos = estado.movimientos.filter(x => x.id !== m.id);
    editandoMov = null;
    render(); guardar();
  };
  return caja;
}

/** Con texto en el buscador, la lista deja el mes y busca en toda la historia. */
function renderBusqueda(texto) {
  // Las palabras buscan en concepto y categoría; las cifras, en el monto ("45.000" = 45000).
  const r = raiz(texto), cifra = texto.replace(/\D/g, "");
  const lista = movimientosEntre("0000-01-01", "9999-12-31")
    .filter(x => (r && (raiz(x.concepto).includes(r) || raiz(x.categoria).includes(r)))
              || (cifra && String(x.monto).includes(cifra)))
    .reverse();
  const cont = $("listaMovs");
  cont.innerHTML = "";
  if (!lista.length) cont.innerHTML = '<div class="vacio">Nada coincide con "' + esc(texto) + '".</div>';
  lista.slice(0, 200).forEach(x => {
    const fila = document.createElement("div");
    fila.className = "fila";
    const marca = document.createElement("span");
    const entra = ["ingreso", "retiro", "le devolvieron", "avance a la cuenta"].includes(x.tipo);
    marca.className = "badge " + (x.clase === "tarjeta" ? "tarjeta" : x.clase === "ahorro" ? "ahorro" : entra ? "in" : "out");
    marca.textContent = x.tipo;
    const ir = document.createElement("button");
    ir.className = "ghost";
    ir.textContent = "Ir al mes";
    ir.onclick = () => { $("buscarMovs").value = ""; irAMes(mesDe(x.fecha)); };
    fila.append(marca, textoFila(x.concepto || x.tipo,
      new Date(x.fecha + "T12:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })
      + (x.categoria ? " · " + x.categoria : "")), valorFila(cop(x.monto)), ir);
    cont.append(fila);
  });
  const total = lista.reduce((s, x) => s + x.monto, 0);
  $("contMovs").textContent = lista.length + (lista.length === 1 ? " resultado · " : " resultados · ") + cop(total);
}

function renderMovimientos(todos = eventosDelMes()) {
  const etiqueta = { gasto: "Gasto", ingreso: "Ingreso", aporte: "Aporte a ahorro", retiro: "Retiro de ahorro" };
  const buscado = $("buscarMovs").value.trim();
  $("filtros").hidden = !!buscado;
  if (buscado) { renderBusqueda(buscado); return; }

  const movs = todos.filter(m => {
    if (filtroMovs === "entrada") return esEntrada(m.tipo);
    if (filtroMovs === "salida") return !esEntrada(m.tipo);
    if (filtroMovs === "fijo") return m.origen === "fijo";
    if (filtroMovs === "ahorro") return m.tipo === "aporte" || m.tipo === "retiro";
    if (filtroMovs === "tarjeta") return ["compra", "avance", "pagoTarjeta"].includes(m.origen);
    if (filtroMovs === "prestamo") return m.origen === "prestamo" || m.origen === "abono";
    return true;
  });

  const cont = $("listaMovs");
  cont.innerHTML = "";
  if (!movs.length) {
    cont.innerHTML = '<div class="vacio">Nada que mostrar con este filtro.</div>';
  }

  movs.forEach(m => {
    if (m.origen === "mov" && editandoMov === m.id && editandoMovEn === "movs") {
      cont.append(formularioMovimiento(estado.movimientos.find(x => x.id === m.id)));
      return;
    }
    const entrada = esEntrada(m.tipo);
    const fila = document.createElement("div");
    fila.className = "fila";

    // Mover plata a un ahorro no es gastarla: lleva su propia marca en oro.
    const esAhorro = m.tipo === "aporte" || m.tipo === "retiro";
    // Una compra con tarjeta no es salida todavía: sale cuando se paga el extracto.
    const esCompra = m.origen === "compra";
    const marca = document.createElement("span");
    marca.className = "badge " + (esCompra ? "tarjeta" : esAhorro ? "ahorro" : entrada ? "in" : "out");
    marca.textContent = esCompra ? "Tarjeta" : esAhorro ? "Ahorro" : entrada ? "Entrada" : "Salida";

    const detalle = [diaCorto(m.fecha)];
    if (m.origen === "fijo") detalle.push("Pago de gasto fijo", m.categoria);
    else if (esCompra) detalle.push(m.categoria, m.ref.cuotas === 1 ? "1 cuota" : m.ref.cuotas + " cuotas");
    else if (m.origen === "avance") detalle.push("Avance de la tarjeta", m.ref.cuotas + " cuota(s)");
    else if (m.origen === "pagoTarjeta") detalle.push("Pago del extracto");
    else if (m.origen === "prestamo") detalle.push("Plata prestada");
    else if (m.origen === "abono") detalle.push("Abono a préstamo");
    else {
      detalle.push(etiqueta[m.tipo]);
      if (m.tipo === "gasto") detalle.push(m.categoria);
      else if (m.ahorro) detalle.push(nombreAhorro(m.ahorro));
      else if (m.sueldo) detalle.push(nombreSueldo(m.sueldo));
    }

    const boton = document.createElement("button");
    boton.className = "ghost";
    if (m.origen === "compra" || m.origen === "avance") {
      boton.textContent = "Editar";
      boton.onclick = () => abrirEdicionCompra(m.ref.id);
    } else if (m.origen === "pagoTarjeta") {
      boton.textContent = "Ver";
      boton.onclick = () => irAVista("tarjeta");
    } else if (m.origen === "prestamo" || m.origen === "abono") {
      boton.textContent = "Ver";
      boton.onclick = () => irAVista("prestamos");
    } else if (m.origen === "fijo") {
      boton.textContent = "Desmarcar";
      boton.onclick = () => { delete m.ref.pagado[mes]; render(); guardar(); };
    } else {
      boton.textContent = "Borrar";
      boton.onclick = () => {
        estado.movimientos = estado.movimientos.filter(x => x.id !== m.id);
        render(); guardar();
      };
    }

    fila.append(marca, textoFila(m.concepto || etiqueta[m.tipo], detalle.join(" · ")),
                valorFila((esCompra ? "" : entrada ? "+" : "−") + cop(m.monto).replace("-", ""),
                          esCompra ? "tarjeta" : esAhorro ? "ahorro" : entrada ? "entrada" : "salida"));
    if (m.origen === "mov") {
      const editar = document.createElement("button");
      editar.className = "ghost";
      editar.textContent = "Editar";
      editar.onclick = () => { editandoMov = m.id; editandoMovEn = "movs"; render(); };
      fila.append(editar);
    }
    fila.append(boton);
    cont.append(fila);
  });

  const entradas = todos.filter(m => esEntrada(m.tipo)).reduce((s, m) => s + m.monto, 0);
  const salidas = todos.filter(m => !esEntrada(m.tipo) && m.origen !== "compra").reduce((s, m) => s + m.monto, 0);
  $("contMovs").textContent = "+" + cop(entradas) + "  −" + cop(salidas);

  [...$("filtros").children].forEach(b => b.classList.toggle("activo", b.dataset.filtro === filtroMovs));
}

/* ---------------------------------------------------------- lo que viene */
/** El día del mes en que suele pagarse un fijo, según el último pago marcado. */
function diaHabitual(f) {
  const fechas = Object.values(f.pagado).sort();
  return fechas.length ? Number(fechas[fechas.length - 1].slice(8, 10)) : null;
}

function fechaEn(m, dia) {
  const ultimo = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  return m + "-" + String(Math.min(dia, ultimo)).padStart(2, "0");
}

/** Pagos y cobros pendientes del mes visible y los dos siguientes. */
function venideros() {
  const meses = [mes, mesSiguiente(mes), mesMas(mes, 2)];
  return meses.map(m => {
    const items = [];
    estado.fijos.filter(f => enVigencia(f, m) && !f.pagado[m]).forEach(f => {
      const dia = diaHabitual(f);
      items.push({ fecha: dia ? fechaEn(m, dia) : null, concepto: f.concepto, detalle: f.categoria,
                   monto: montoVigente(f, m), sale: true, aprox: true });
    });
    if (estado.tarjeta) {
      const t = tarjetaDelMes(m);
      if (t.total && !t.pago) items.push({
        fecha: fechaDePago(m), concepto: "Pago de la tarjeta",
        detalle: [t.cuotas.length ? t.cuotas.length + " cuota(s)" : "",
                  t.interes ? cop(t.interes) + " de interés" : "",
                  t.manejo ? "manejo " + cop(t.manejo) : ""].filter(Boolean).join(" · "),
        monto: t.total, sale: true, tarjeta: true
      });
    }
    estado.sueldos.filter(s => enVigencia(s, m)).forEach(s => cuotasDe(s, m).forEach(q => {
      const falta = q.monto - q.recibido;
      if (falta > 0) items.push({ fecha: q.fecha, concepto: s.concepto, detalle: q.etiqueta,
                                  monto: falta, sale: false, aprox: true });
    }));
    estado.prestamos.forEach(p => {
      const e = estadoPrestamo(p);
      if (!e.pendiente || !p.acordada) return;
      // Lo vencido se arrastra al primer mes, que es cuando hay que cobrarlo.
      const cae = mesDe(p.acordada) === m || (m === meses[0] && mesDe(p.acordada) < m);
      if (cae) items.push({ fecha: p.acordada, concepto: p.persona + " le paga",
                            detalle: e.texto, monto: e.pendiente, sale: false, vencido: e.clave === "vencido" });
    });
    items.sort((a, b) => (a.fecha || "9").localeCompare(b.fecha || "9"));
    return { mes: m, items };
  });
}

function renderPortada(c, eventos, agenda) {
  $("portadaLibre").textContent = cop(c.libre);
  $("portadaLibre").classList.toggle("neg", c.libre < 0);
  $("portadaEntradas").textContent = cop(c.entradas);
  $("portadaSalidas").textContent = cop(c.salidas);

  const listas = [
    ["portadaPagos", agenda.filter(item => item.sale).slice(0, 4), "No hay pagos pendientes este mes."],
    ["portadaMovimientos", eventos.slice(0, 4), "No hay movimientos este mes."]
  ];
  for (const [id, items, vacio] of listas) {
    const cont = $(id);
    cont.replaceChildren();
    if (!items.length) {
      const p = document.createElement("p");
      p.className = "vacio";
      p.textContent = vacio;
      cont.append(p);
    }
    for (const item of items) {
      const fila = document.createElement("div");
      fila.className = "fila portada-fila";
      const pagos = id === "portadaPagos";
      const fecha = item.fecha ? (item.aprox ? "≈ " : "") + diaCorto(item.fecha) : "Sin fecha";
      const categoria = item.tipo === "compra" ? "Compra con tarjeta" : item.categoria;
      const entrada = esEntrada(item.tipo);
      const clase = pagos || item.tipo === "compra" ? "" : entrada ? "entrada" : "salida";
      const signo = clase ? (entrada ? "+" : "−") : "";
      const descripcion = [categoria, fecha].filter(Boolean).join(" · ");
      fila.append(textoFila(item.concepto, descripcion), valorFila(signo + cop(item.monto), clase));
      cont.append(fila);
    }
  }
}

function renderCalendario(agenda) {
  const cont = $("calendario");
  cont.innerHTML = "";
  let totalSale = 0;
  agenda.forEach(({ mes: m, items }) => {
    const sale = items.filter(i => i.sale).reduce((s, i) => s + i.monto, 0);
    const entra = items.filter(i => !i.sale).reduce((s, i) => s + i.monto, 0);
    totalSale += sale;

    const bloque = document.createElement("div");
    bloque.className = "cal-mes";
    const cab = document.createElement("div");
    cab.className = "cal-cab";
    cab.innerHTML = "<b></b><span></span>";
    cab.querySelector("b").textContent = nombreMes(m);
    cab.querySelector("span").textContent = "sale " + cop(sale) + (entra ? " · entra " + cop(entra) : "");
    bloque.append(cab);

    if (!items.length) {
      const v = document.createElement("div");
      v.className = "vacio";
      v.textContent = "Nada pendiente.";
      bloque.append(v);
    }
    items.forEach(i => {
      const fila = document.createElement("div");
      const atrasado = i.fecha && i.fecha < hoy();
      fila.className = "fila cal-fila" + (atrasado || i.vencido ? " atrasado" : "");
      const dia = document.createElement("span");
      dia.className = "cal-dia";
      dia.textContent = i.fecha ? (i.aprox ? "~" : "") + diaCorto(i.fecha) : "sin día";
      fila.append(dia, textoFila(i.concepto, i.detalle + (atrasado && !i.vencido ? " · atrasado" : "")),
                  valorFila((i.sale ? "−" : "+") + cop(i.monto), i.sale ? (i.tarjeta ? "tarjeta" : "salida") : "entrada"));
      bloque.append(fila);
    });
    cont.append(bloque);
  });
  $("calResumen").textContent = "sale " + cop(totalSale) + " en 3 meses";
}

function renderHistoria() {
  const meses = mesesRegistrados();
  if (!meses.includes(mes)) meses.push(mes);
  meses.sort();

  const cuerpo = $("cuerpoHist");
  cuerpo.innerHTML = "";
  if (!meses.length) {
    cuerpo.innerHTML = '<tr><td colspan="9" class="vacio">Aún no hay meses registrados.</td></tr>';
    $("histResumen").textContent = "";
    return;
  }

  meses.slice().reverse().forEach(m => {
    const r = resumenMes(m);
    const tr = document.createElement("tr");
    if (m === mes) tr.className = "actual";

    const celdas = [
      nombreMes(m) + (r.inicialManual ? " *" : ""),
      cop(r.inicial), "+" + cop(r.entradas), "−" + cop(r.salidas),
      cop(r.saldo), r.pendiente ? cop(r.pendiente) : "—", cop(r.ahorroTotal), cop(r.patrimonio)
    ];
    celdas.forEach((t, i) => {
      const td = document.createElement("td");
      td.textContent = t;
      if (i > 0) td.className = "num";
      if (i === 4 && r.saldo < 0) td.classList.add("neg");
      tr.append(td);
    });

    const td = document.createElement("td");
    const ir = document.createElement("button");
    ir.className = "ghost";
    ir.textContent = m === mes ? "Aquí" : "Ver";
    ir.disabled = m === mes;
    ir.onclick = () => { mes = m; editando = null; render(); };
    td.append(ir);
    tr.append(td);

    cuerpo.append(tr);
  });

  $("histResumen").textContent = meses.length + (meses.length === 1 ? " mes" : " meses");
}

/* --------------------------------------------------------------- eventos */
function llenarOpciones(select, lista) {
  lista.forEach(k => {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = k;
    select.append(o);
  });
}

/** El selector de categoría cambia según se trate de una entrada, un gasto o un ahorro. */
function ajustarFormulario() {
  const tipo = $("gTipo").value;
  const sel = $("gCat");
  const lista = tipo === "ingreso" ? ORIGENES : CATEGORIAS;
  const deTarjeta = tipo === "tarjeta" || tipo === "avance";
  const previo = sel.value;
  sel.innerHTML = "";
  llenarOpciones(sel, lista);
  sel.value = lista.includes(previo) ? previo : lista[0];

  const esAhorro = tipo === "aporte" || tipo === "retiro";
  $("campoAhorro").hidden = !esAhorro;
  $("campoCat").hidden = esAhorro || tipo === "avance";
  $("campoCuotas").hidden = !deTarjeta;
  $("formRapido").classList.toggle("con-cuotas", tipo === "tarjeta");
  $("formRapido").classList.toggle("sin-cat", tipo === "avance");
  const nota = $("notaRapida");
  nota.hidden = !deTarjeta;
  if (deTarjeta && !estado.tarjeta) nota.textContent = "Primero configure la tarjeta en la sección Tarjeta.";
  else if (tipo === "avance") nota.textContent = "El avance llega a su cuenta de ahorros y suma al saldo. Se paga en el extracto, hasta 24 cuotas, con intereses desde la primera"
    + (estado.tarjeta && estado.tarjeta.comisionAvance ? ", más " + cop(estado.tarjeta.comisionAvance) + " de comisión." : ".");
  else if (tipo === "tarjeta") nota.textContent = "No sale del saldo hoy: se paga en el extracto. A una cuota no tiene intereses.";
  if (esAhorro) {
    const bolsillo = $("gAhorro");
    const antes = bolsillo.value;
    bolsillo.innerHTML = '<option value="">Sin bolsillo</option>';
    estado.ahorros.forEach(a => {
      const o = document.createElement("option");
      o.value = a.id;
      o.textContent = a.concepto;
      bolsillo.append(o);
    });
    bolsillo.value = antes;
  }
}

function agregarMovimiento() {
  const monto = Number($("gMonto").value);
  if (!monto || monto <= 0) { $("gMonto").focus(); return; }
  const tipo = $("gTipo").value;
  const fecha = $("gFecha").value || diaDentroDe(mes);
  const esAhorro = tipo === "aporte" || tipo === "retiro";
  if (tipo === "tarjeta" || tipo === "avance") {
    const ok = agregarCompra({ fecha, tipo: tipo === "avance" ? "avance" : "compra", monto, cuotas: $("gCuotas").value,
                               concepto: $("gDesc").value.trim() || (tipo === "avance" ? "Avance a la cuenta" : ""),
                               categoria: tipo === "avance" ? "Otros" : $("gCat").value });
    if (!ok) return;
    $("gCuotas").value = 1;
  } else estado.movimientos.push({
    id: uid(), fecha, tipo,
    concepto: $("gDesc").value.trim(),
    categoria: esAhorro ? "Otros" : $("gCat").value,
    monto,
    ahorro: esAhorro ? ($("gAhorro").value || null) : null
  });
  if (mesDe(fecha) !== mes) mes = mesDe(fecha);
  $("gDesc").value = "";
  $("gMonto").value = "";
  $("gDesc").focus();
  render();
  guardar();
}

function agregarIngreso() {
  const monto = Number($("iMonto").value);
  if (!monto || monto <= 0) { $("iMonto").focus(); return; }
  const fecha = $("iFecha").value || diaDentroDe(mes);
  const [idSueldo, cuota] = ($("campoSueldo").hidden ? "" : $("iSueldo").value).split("|");
  estado.movimientos.push({
    id: uid(), fecha, tipo: "ingreso",
    concepto: $("iDesc").value.trim(), categoria: $("iCat").value, monto, ahorro: null,
    sueldo: idSueldo || null, cuota: idSueldo ? Number(cuota) : null
  });
  if (mesDe(fecha) !== mes) mes = mesDe(fecha);
  $("iDesc").value = "";
  $("iMonto").value = "";
  $("iDesc").focus();
  render();
  guardar();
}

function agregarSueldo() {
  const concepto = $("sConcepto").value.trim() || "Sueldo";
  const monto = Number($("sMonto").value);
  if (!monto) { $("sMonto").focus(); return; }
  estado.sueldos.push({
    id: uid(), concepto, monto, frecuencia: $("sFrec").value,
    montos: {}, desde: mes, hasta: null
  });
  $("sConcepto").value = "";
  $("sMonto").value = "";
  ajustarIngreso();
  render();
  guardar();
}

/** El campo de sueldo solo aparece cuando el ingreso viene de uno configurado. */
function ajustarIngreso() {
  const hay = estado.sueldos.length > 0;
  const campo = $("campoSueldo");
  campo.hidden = !hay || $("iCat").value !== "Sueldo";
  if (campo.hidden) return;
  const sel = $("iSueldo");
  const antes = sel.value;
  sel.innerHTML = '<option value="">Sin vincular</option>';
  estado.sueldos.forEach(s => {
    (FRECUENCIAS[s.frecuencia] > 1
      ? cuotasDe(s, mes).map(q => [s.id + "|" + q.indice, s.concepto + " · " + q.etiqueta])
      : [[s.id + "|0", s.concepto]]
    ).forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      sel.append(o);
    });
  });
  sel.value = antes;
}

function agregarFijo() {
  const concepto = $("fConcepto").value.trim();
  const monto = Number($("fMonto").value);
  if (!concepto || !monto) { $("fConcepto").focus(); return; }
  // Un pago único vive solo en este mes: hasta lo deja fuera del siguiente.
  const unico = $("fRepite").value === "unico";
  estado.fijos.push({
    id: uid(), concepto, categoria: $("fCat").value, monto,
    montos: {}, desde: mes, hasta: unico ? mes : null, pagado: {}
  });
  $("fConcepto").value = "";
  $("fMonto").value = "";
  render();
  guardar();
}

function agregarAhorro() {
  const concepto = $("aNombre").value.trim();
  const monto = Number($("aMonto").value);
  if (!concepto || !monto) { $("aNombre").focus(); return; }
  estado.ahorros.push({
    id: uid(), concepto,
    objetivo: Number($("aObjetivo").value) || 0,
    inicial: Number($("aInicial").value) || 0,
    monto, montos: {}, desde: mes, hasta: null
  });
  $("aNombre").value = "";
  $("aMonto").value = "";
  $("aObjetivo").value = "";
  $("aInicial").value = "";
  ajustarFormulario();
  render();
  guardar();
}

function irAMes(nuevo) {
  mes = nuevo;
  editando = null;
  editandoMov = null;
  accion = {};
  verTerminados = false;
  $("gFecha").value = diaDentroDe(mes);
  $("iFecha").value = diaDentroDe(mes);
  ajustarIngreso();
  render();
}

function iniciarAplicacion() {
  llenarOpciones($("gCat"), CATEGORIAS);
  llenarOpciones($("fCat"), CATEGORIAS);
  llenarOpciones($("iCat"), ORIGENES);
  $("gCat").value = "Alimentación";
  $("fCat").value = "Vivienda";
  $("iCat").value = "Sueldo";
  $("gFecha").value = hoy();
  $("iFecha").value = hoy();

  $("btnAgregar").onclick = agregarMovimiento;
  ["gDesc", "gMonto"].forEach(id =>
    $(id).addEventListener("keydown", e => { if (e.key === "Enter") agregarMovimiento(); }));
  $("gTipo").onchange = ajustarFormulario;

  $("btnIngreso").onclick = agregarIngreso;
  ["iDesc", "iMonto"].forEach(id =>
    $(id).addEventListener("keydown", e => { if (e.key === "Enter") agregarIngreso(); }));
  $("iCat").onchange = ajustarIngreso;

  $("btnSueldo").onclick = agregarSueldo;
  ["sConcepto", "sMonto"].forEach(id =>
    $(id).addEventListener("keydown", e => { if (e.key === "Enter") agregarSueldo(); }));

  $("btnFijo").onclick = agregarFijo;
  ["fConcepto", "fMonto"].forEach(id =>
    $(id).addEventListener("keydown", e => { if (e.key === "Enter") agregarFijo(); }));

  $("btnAhorro").onclick = agregarAhorro;
  ["aNombre", "aMonto", "aObjetivo"].forEach(id =>
    $(id).addEventListener("keydown", e => { if (e.key === "Enter") agregarAhorro(); }));

  $("selMes").onchange = e => irAMes(e.target.value || mes);
  $("btnMesAnt").onclick = () => irAMes(mesAnterior(mes));
  $("btnMesSig").onclick = () => irAMes(mesSiguiente(mes));
  $("btnHoy").onclick = () => irAMes(mesDe(hoy()));
  $("btnNuevoMovimiento").onclick = () => {
    $("panelNuevoMovimiento").scrollIntoView({ block: "start" });
    $("gDesc").focus({ preventScroll: true });
  };
  $("btnAsistenteResumen").onclick = () => irAVista("asistente");
  $("btnMovimientosResumen").onclick = () => irAVista("movimientos");
  $("btnAgendaResumen").onclick = () => {
    $("agendaResumen").scrollIntoView({ block: "start" });
    $("agendaResumen").querySelector("h2").focus({ preventScroll: true });
  };

  $("inpInicial").onchange = e => {
    const v = e.target.value.trim();
    if (v === "") delete estado.saldoInicial[mes];
    else estado.saldoInicial[mes] = Number(v);
    render(); guardar();
  };
  $("btnArrastre").onclick = () => {
    delete estado.saldoInicial[mes];
    render(); guardar();
  };

  $("filtros").onclick = e => {
    const b = e.target.closest("button[data-filtro]");
    if (!b) return;
    filtroMovs = b.dataset.filtro;
    renderMovimientos();
  };

  $("btnRecargar").onclick = cargar;
  $("btnCrearPerfil").onclick = () => {
    if (!guardarAhora()) { marcar("No se pudo guardar; el perfil no cambió", "mal"); return; }
    document.querySelector(".perfil-local").open = false;
    mostrarAuth("registro", true);
  };
  $("btnCerrarSesion").onclick = salirPerfil;
  $("btnExportar").onclick = exportar;
  $("btnImportar").onclick = () => $("inputImport").click();
  $("inputImport").onchange = e => {
    if (e.target.files[0]) importar(e.target.files[0]);
    e.target.value = "";
  };
  window.addEventListener("beforeunload", e => {
    if (sinGuardar) { e.preventDefault(); e.returnValue = ""; }
  });

  // Los gráficos se ajustan al ancho: se vuelven a dibujar al cambiar el tamaño.
  let redibujo = null;
  window.addEventListener("resize", () => {
    clearTimeout(redibujo);
    redibujo = setTimeout(() => renderGraficos(consumoPorCategoria(mes).pares), 150);
  });

  $("nav").onclick = e => {
    const b = e.target.closest("button[data-ir]");
    if (b) irAVista(b.dataset.ir);
  };
  $("btnTema").onclick = cambiarTema;
  let vista = "resumen";
  try { vista = localStorage.getItem("vista") || vista; } catch (e) { /* idem */ }
  if (VISTAS.includes(location.hash.slice(1))) vista = location.hash.slice(1);
  irAVista(vista, true);

  iniciarTarjeta();
  iniciarPrestamos();
  iniciarPresupuesto();
  iniciarAsistente();
  $("buscarMovs").oninput = () => renderMovimientos();
  ajustarFormulario();
  ajustarIngreso();
  render();
  cargar().then(() => { ajustarFormulario(); ajustarIngreso(); notificarPendientes(); if (libretaCargada) iniciarGuia(); });
}

async function salirPerfil() {
  const boton = $("btnCerrarSesion");
  if (boton.disabled) return;
  boton.disabled = true;
  if (!guardarAhora()) { boton.disabled = false; marcar("No se pudo guardar; no se cerró la sesión", "mal"); return; }
  try {
    const r = await fetch("/api/salir", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Libreta-Sesion": contextoSesion || "" },
      body: "{}"
    });
    if (r.status === 409 || r.status === 401) { manejarCambioSesion(false); return; }
    if (!r.ok) {
      const error = await r.json().catch(() => ({}));
      throw new Error(error.error || r.status);
    }
    location.replace(location.pathname);
  } catch (e) {
    marcar("No se pudo cerrar sesión: " + e.message, "mal");
  } finally {
    boton.disabled = false;
  }
}

let perfilesExistentes = false;
let authModo = "ingreso";
let authEnCurso = false;

function mostrarAuth(modo, desdeApp = false) {
  authModo = modo;
  const app = document.querySelector(".app");
  if (app) app.style.display = "none";
  $("cargaLibreta").hidden = true;
  $("authScreen").hidden = false;
  $("authError").hidden = true;
  $("authError").textContent = "";
  $("authUsuario").value = "";
  $("authContrasena").value = "";
  $("authTitulo").textContent = modo === "ingreso"
    ? "Entra a tu perfil"
    : (desdeApp ? "Añade otro perfil" : perfilesExistentes ? "Crea otro perfil" : "Crea el perfil principal");
  $("authDescripcion").textContent = modo === "ingreso"
    ? "Ingresa con el nombre y la contraseña de tu perfil en este equipo."
    : (desdeApp
      ? "El nuevo perfil tendrá una libreta independiente. Al crearlo, esta ventana cambiará a ese perfil."
      : perfilesExistentes
        ? "Cada perfil tiene su propia libreta y sus movimientos."
        : "Crea una contraseña para guardar tu libreta y seguir desde este equipo.");
  $("authImportInfo").hidden = !(modo === "registro" && !perfilesExistentes && !desdeApp);
  $("authEnviar").textContent = modo === "ingreso" ? "Entrar" : "Crear perfil";
  $("authContrasena").autocomplete = modo === "ingreso" ? "current-password" : "new-password";
  $("authCambiarModo").hidden = !perfilesExistentes || desdeApp;
  $("authCambiarModo").textContent = modo === "ingreso" ? "Crear otro perfil" : "Volver al inicio de sesión";
  $("authVolverApp").hidden = !desdeApp;
  $("authForm").hidden = false;
  $("authUsuario").focus();
}

function mostrarErrorAuth(mensaje) {
  $("authError").textContent = mensaje;
  $("authError").hidden = false;
}

async function enviarAuth(e) {
  e.preventDefault();
  if (authEnCurso) return;
  const usuario = $("authUsuario").value.trim();
  const contrasena = $("authContrasena").value;
  if (!usuario || usuario.length > 40 || contrasena.length < 8 || contrasena.length > 1024) {
    mostrarErrorAuth("Use un nombre de hasta 40 caracteres y una contraseña de 8 a 1024 caracteres.");
    return;
  }
  const registro = authModo === "registro";
  const boton = $("authEnviar");
  authEnCurso = true;
  boton.disabled = true;
  $("authCambiarModo").disabled = true;
  $("authVolverApp").disabled = true;
  $("authError").hidden = true;
  try {
    const r = await fetch(registro ? "/api/registro" : "/api/ingreso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, contrasena })
    });
    const respuesta = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(respuesta.error || "No se pudo completar el acceso.");
    location.replace(location.pathname);
  } catch (error) {
    mostrarErrorAuth(error.message || "No se pudo conectar con la libreta.");
  } finally {
    authEnCurso = false;
    boton.disabled = false;
    $("authCambiarModo").disabled = false;
    $("authVolverApp").disabled = false;
  }
}

async function iniciar() {
  $("authForm").addEventListener("submit", enviarAuth);
  $("authCambiarModo").onclick = () => mostrarAuth(authModo === "ingreso" ? "registro" : "ingreso");
  $("authVolverApp").onclick = () => {
    $("authUsuario").value = "";
    $("authContrasena").value = "";
    $("authScreen").hidden = true;
    document.querySelector(".app").style.display = "";
  };
  try {
    const sesion = await fetch("/api/sesion", { cache: "no-store" });
    if (sesion.ok) {
      const datos = await sesion.json();
      if (!datos.usuario || !datos.contexto) throw new Error("La sesión no tiene un contexto válido.");
      contextoSesion = datos.contexto;
      $("usuarioActivo").textContent = datos.usuario;
      iniciarAplicacion();
      return;
    }
    if (sesion.status !== 401) throw new Error("No se pudo comprobar la sesión.");
    const perfiles = await fetch("/api/perfiles", { cache: "no-store" });
    if (!perfiles.ok) throw new Error("No se pudo comprobar si ya hay perfiles.");
    perfilesExistentes = Boolean((await perfiles.json()).hayUsuarios);
    mostrarAuth(perfilesExistentes ? "ingreso" : "registro");
  } catch (error) {
    $("cargaLibreta").textContent = "No se pudo comprobar el perfil. Cierre y vuelva a abrir la libreta.";
  }
}

document.addEventListener("DOMContentLoaded", iniciar);
