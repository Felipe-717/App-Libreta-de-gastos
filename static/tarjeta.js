"use strict";

/*
 * Tarjeta de crédito. Comprar con la tarjeta no saca plata de la cuenta: la saca
 * el pago mensual del extracto, que suma las cuotas de cada compra, sus intereses
 * y la cuota de manejo. Por eso las compras viven aparte de los movimientos, y lo
 * que toca el saldo es el pago registrado de cada mes.
 */

// Referencia de la Mastercard Oro Bancolombia, consultada en octubre de 2026.
// El extracto manda: todo se puede editar.
const TARJETA_REF = {
  nombre: "Mastercard Oro Bancolombia", tasaEA: 28.56, manejo: 36990,
  comisionAvance: 8140,   // $6.840 + IVA, avance desde la app o la sucursal virtual
  cuotasAvance: 24        // plazo máximo de un avance
};

let editandoTarjeta = false;
let pagandoTarjeta = false;
let verCompraPagadas = false;
let editandoCompra = null;   // id de la compra o avance que se está editando

const tasaMensual = ea => Math.pow(1 + (Number(ea) || 0) / 100, 1 / 12) - 1;
const porcentaje = x => x.toLocaleString("es-CO", { maximumFractionDigits: 2 }) + "%";

function normalizarTarjeta(t) {
  if (!t) return null;
  const pagos = {};
  for (const [k, v] of Object.entries(t.pagos || {})) {
    if (v && v.fecha) pagos[k] = { fecha: v.fecha, monto: Number(v.monto) || 0 };
  }
  return {
    nombre: t.nombre || TARJETA_REF.nombre,
    cupo: Number(t.cupo) || 0,
    tasaEA: Number(t.tasaEA) || 0,
    manejo: Number(t.manejo) || 0,
    manejos: normalizarMontos(t.manejos),
    diaCorte: Math.min(Math.max(Number(t.diaCorte) || 1, 1), 31),
    diaPago: Math.min(Math.max(Number(t.diaPago) || 1, 1), 31),
    comisionAvance: Number(t.comisionAvance) || 0,
    desde: t.desde || null,
    pagos
  };
}

function normalizarCompra(c) {
  return {
    id: c.id || uid(), fecha: c.fecha || hoy(),
    tipo: c.tipo === "avance" ? "avance" : "compra",
    concepto: c.concepto || "", categoria: c.categoria || "Otros",
    monto: Number(c.monto) || 0,
    cuotas: Math.max(1, Math.round(Number(c.cuotas) || 1)),
    tasaEA: Number(c.tasaEA) || 0,
    comision: Number(c.comision) || 0,
    liquidada: c.liquidada || null,
    // Cuotas que ya se pagaron por fuera de la libreta: antes de usarla, o por adelantado.
    pagadasAntes: Math.min(Math.max(Math.round(Number(c.pagadasAntes) || 0), 0), Math.max(1, Math.round(Number(c.cuotas) || 1)))
  };
}

/** Mes en que se paga lo que se compró en esa fecha: depende del corte. */
function mesDePago(fecha) {
  const t = estado.tarjeta;
  const corte = Number(fecha.slice(8, 10)) <= t.diaCorte ? mesDe(fecha) : mesSiguiente(mesDe(fecha));
  return t.diaPago > t.diaCorte ? corte : mesSiguiente(corte);
}

const fechaDePago = m => {
  const ultimo = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  return m + "-" + String(Math.min(estado.tarjeta.diaPago, ultimo)).padStart(2, "0");
};

/**
 * Plan de pagos de una compra como lo liquida Bancolombia: abono a capital fijo
 * y los intereses sobre el saldo que queda. A una cuota la compra no paga interés;
 * el avance sí, y además carga su comisión en el primer extracto.
 */
const cachePlanes = new Map();

function planCompra(c) {
  if (!estado.tarjeta) return [];
  if (cachePlanes.has(c.id)) return cachePlanes.get(c.id);
  const n = c.cuotas;
  const i = n === 1 && c.tipo === "compra" ? 0 : tasaMensual(c.tasaEA);
  let saldo = c.monto, m = mesDePago(c.fecha);
  const plan = [];
  for (let k = 1; k <= n && saldo > 0.5; k++, m = mesSiguiente(m)) {
    // Liquidar es pagar todo lo que falta en ese extracto y dejar de pagar cuotas.
    const liquida = !!c.liquidada && m >= c.liquidada;
    // Con pesos redondeados, la última cuota absorbe la diferencia y el total cuadra.
    const capital = liquida || k === n ? saldo : Math.round(c.monto / n);
    plan.push({
      mes: m, numero: k, capital, interes: Math.round(saldo * i),
      comision: k === 1 ? c.comision : 0, saldoDespues: saldo - capital,
      previa: k <= (c.pagadasAntes || 0)
    });
    saldo -= capital;
    if (liquida) break;
  }
  cachePlanes.set(c.id, plan);
  return plan;
}

function manejoDe(m) {
  const t = estado.tarjeta;
  if (!t || (t.desde && m < t.desde)) return 0;
  return montoVigente({ monto: t.manejo, montos: t.manejos }, m);
}

/** El extracto que se paga en el mes m. */
function tarjetaDelMes(m) {
  const t = estado.tarjeta;
  const r = { cuotas: [], capital: 0, interes: 0, comisiones: 0, manejo: manejoDe(m),
              total: 0, pago: (t && t.pagos[m]) || null };
  if (!t) return r;
  estado.compras.forEach(c => planCompra(c).forEach(q => {
    // Una cuota ya pagada por fuera no se vuelve a cobrar en el extracto.
    if (q.mes !== m || q.previa) return;
    r.cuotas.push({ compra: c, ...q });
    r.capital += q.capital;
    r.interes += q.interes;
    r.comisiones += q.comision;
  }));
  r.total = r.capital + r.interes + r.comisiones + r.manejo;
  return r;
}

/** Capital que se sigue debiendo al cerrar el mes m: lo de extractos sin pagar y lo futuro. */
function deudaTarjeta(m) {
  const t = estado.tarjeta;
  if (!t) return 0;
  let deuda = 0;
  estado.compras.forEach(c => {
    if (mesDe(c.fecha) > m) return;
    planCompra(c).forEach(q => { if (!q.previa && (q.mes > m || !t.pagos[q.mes])) deuda += q.capital; });
  });
  return deuda;
}

/** Lo que falta de una compra: capital de las cuotas aún no pagadas. */
function pendienteCompra(c) {
  const pagos = estado.tarjeta.pagos;
  const plan = planCompra(c);
  const pendientes = plan.filter(q => !q.previa && !pagos[q.mes]);
  return {
    plan, pendientes,
    capital: pendientes.reduce((s, q) => s + q.capital, 0),
    interes: pendientes.reduce((s, q) => s + q.interes, 0),
    pagadas: plan.length - pendientes.length
  };
}

/** Fecha de corte del extracto que se paga en el mes mPago. */
function corteDe(mPago) {
  const t = estado.tarjeta;
  return fechaEn(t.diaPago > t.diaCorte ? mPago : mesAnterior(mPago), t.diaCorte);
}

/**
 * El extracto que toca mirar hoy. Si ya cortó alguno y no está pagado, ese: vencido
 * si pasó su fecha de pago, abierto si no. Si no, el que está corriendo, que todavía
 * no corta pero se puede pagar por adelantado.
 */
function extractoDeHoy() {
  const t = estado.tarjeta;
  if (!t) return null;
  const hoyF = hoy(), actual = mesDe(hoyF);
  for (let k = -3; k <= 3; k++) {
    const m = mesMas(actual, k);
    if (t.desde && m < t.desde) continue;
    const d = tarjetaDelMes(m);
    if (!d.total || d.pago || corteDe(m) > hoyF) continue;
    return { mes: m, d, estado: fechaDePago(m) < hoyF ? "vencido" : "abierto" };
  }
  for (let k = 0; k <= 3; k++) {
    const m = mesMas(actual, k);
    if (corteDe(m) > hoyF) return { mes: m, d: tarjetaDelMes(m), estado: "en curso" };
  }
  return { mes: actual, d: tarjetaDelMes(actual), estado: null };
}

/** El extracto que se muestra para un mes: por fecha en el mes en curso, por mes en los demás. */
const extractoPara = m => m === mesDe(hoy()) ? extractoDeHoy() : { mes: m, d: tarjetaDelMes(m), estado: null };

/* ---------------------------------------------------------------- render */
function renderTarjeta() {
  cachePlanes.clear();
  const t = estado.tarjeta;
  const configurando = !t || editandoTarjeta;
  $("tarjetaConfig").hidden = !configurando;
  $("tarjetaVista").hidden = configurando;
  $("tarjetaResumen").textContent = "";
  if (configurando) { prepararConfigTarjeta(); return; }

  const ext = extractoPara(mes);
  const deuda = deudaTarjeta(mes);
  $("tarjetaResumen").textContent = ext.d.total && !ext.d.pago
    ? (ext.estado === "en curso" ? "Próximo pago: " : "Por pagar: ") + cop(ext.d.total) + " · vence el " + diaCorto(fechaDePago(ext.mes))
    : "";

  renderCabeceraTarjeta(t, deuda);
  renderPagoTarjeta(ext);
  renderCuotasTarjeta(ext.d);
  renderDeudasTarjeta();
  renderAvances();
  renderProyeccionTarjeta();
  previaCompra();
}

function prepararConfigTarjeta() {
  const t = estado.tarjeta || { ...TARJETA_REF, cupo: "", diaCorte: "", diaPago: "" };
  const campos = { tNombre: t.nombre, tCupo: t.cupo || "", tTasa: t.tasaEA, tManejo: manejoDe(mes) || t.manejo,
                   tCorte: t.diaCorte, tPago: t.diaPago, tComision: t.comisionAvance };
  // No se pisa lo que se está escribiendo cuando otro panel vuelve a pintar.
  if (!$("tarjetaConfig").contains(document.activeElement)) {
    for (const [id, v] of Object.entries(campos)) $(id).value = v;
  }
  $("btnTarjetaCancelar").hidden = !estado.tarjeta;
  $("tarjetaNotaConfig").textContent = estado.tarjeta
    ? "Cambiar la tasa solo afecta las compras nuevas: cada compra guarda la tasa con la que se hizo. "
      + "La cuota de manejo cambia desde " + nombreMes(mes).toLowerCase() + " en adelante."
    : "Valores de referencia de la Mastercard Oro Bancolombia a octubre de 2026: tasa de "
      + porcentaje(TARJETA_REF.tasaEA) + " E.A. (" + porcentaje(100 * tasaMensual(TARJETA_REF.tasaEA))
      + " mensual), manejo de " + cop(TARJETA_REF.manejo) + " al mes y " + cop(TARJETA_REF.comisionAvance)
      + " por avance desde la app. Corrija con su extracto y complete el corte y el día de pago.";
}

function guardarTarjeta() {
  const corte = Number($("tCorte").value), pago = Number($("tPago").value);
  if (!(corte >= 1 && corte <= 31)) { $("tCorte").focus(); return; }
  if (!(pago >= 1 && pago <= 31)) { $("tPago").focus(); return; }
  const nuevo = !estado.tarjeta;
  // La cuota de manejo arranca en el primer extracto que falta por pagar: si el día
  // de pago de este mes ya pasó, ese extracto se pagó por fuera de la libreta.
  const actual = mesDe(hoy());
  const primerPago = Number(hoy().slice(8, 10)) > pago ? mesSiguiente(actual) : actual;
  const t = estado.tarjeta || { manejos: {}, pagos: {}, desde: mes > primerPago ? mes : primerPago };
  t.nombre = $("tNombre").value.trim() || TARJETA_REF.nombre;
  t.cupo = Number($("tCupo").value) || 0;
  t.tasaEA = Number($("tTasa").value) || 0;
  t.diaCorte = corte;
  t.diaPago = pago;
  t.comisionAvance = Number($("tComision").value) || 0;
  const manejo = Number($("tManejo").value) || 0;
  if (nuevo) t.manejo = manejo;
  else if (manejoDe(mes) !== manejo) {
    t.manejos[mes] = manejo;
    if (montoVigente({ monto: t.manejo, montos: t.manejos }, mesAnterior(mes)) === manejo) delete t.manejos[mes];
  }
  estado.tarjeta = normalizarTarjeta(t);
  editandoTarjeta = false;
  render(); guardar();
}

function renderCabeceraTarjeta(t, deuda) {
  const cont = $("tarjetaCabecera");
  cont.innerHTML = "";
  const fila = document.createElement("div");
  fila.className = "fila";
  const editar = document.createElement("button");
  editar.className = "ghost";
  editar.textContent = "Editar tarjeta";
  editar.onclick = () => { editandoTarjeta = true; render(); };
  fila.append(textoFila(t.nombre,
    porcentaje(t.tasaEA) + " E.A. · " + porcentaje(100 * tasaMensual(t.tasaEA)) + " mensual · manejo "
    + cop(manejoDe(mes)) + " · corta el " + t.diaCorte + ", se paga el " + t.diaPago), editar);
  cont.append(fila);

  if (t.cupo) {
    const usado = Math.min(deuda, t.cupo);
    const barra = document.createElement("div");
    barra.className = "cupo";
    barra.innerHTML = '<div class="track"><i></i></div><small></small>';
    barra.querySelector("i").style.width = (100 * usado / t.cupo) + "%";
    barra.querySelector("i").classList.toggle("alto", deuda / t.cupo > 0.7);
    barra.querySelector("small").textContent =
      "Usa " + cop(deuda) + " de " + cop(t.cupo) + " · disponible " + cop(Math.max(t.cupo - deuda, 0));
    cont.append(barra);
  }
}

function renderPagoTarjeta(ext) {
  const d = ext.d, mExt = ext.mes;
  const cont = $("tarjetaPago");
  cont.innerHTML = "";
  cont.className = "pago-tarjeta" + (d.pago ? " pagado" : "") + (ext.estado === "vencido" ? " vencido" : "")
                   + (ext.estado === "en curso" ? " en-curso" : "");

  const titulo = document.createElement("div");
  titulo.className = "pago-titulo";
  titulo.innerHTML = "<small></small><b></b><span></span>";
  const corte = corteDe(mExt), cortó = corte <= hoy();
  titulo.querySelector("small").textContent = d.pago ? "Extracto pagado"
    : ext.estado === "vencido" ? "Vencido · por pagar"
    : ext.estado === "abierto" ? "Por pagar ahora"
    : ext.estado === "en curso" ? "Extracto en curso"
    : "Extracto de " + nombreMes(mExt).toLowerCase();
  titulo.querySelector("b").textContent = cop(d.pago ? d.pago.monto : d.total);
  titulo.querySelector("span").textContent = d.pago
    ? "Pagado el " + diaCorto(d.pago.fecha) + (d.pago.monto !== d.total ? " · el cálculo daba " + cop(d.total) : "")
    : !d.total ? "Nada que pagar"
    : "Vence el " + diaCorto(fechaDePago(mExt)) + " · " + (cortó ? "cortó el " : "corta el ") + diaCorto(corte)
      + (ext.estado === "en curso" ? ". Puede pagarlo por adelantado." : "");
  cont.append(titulo);

  const desglose = document.createElement("div");
  desglose.className = "desglose";
  [["Capital", d.capital], ["Intereses", d.interes], ["Cuota de manejo", d.manejo], ["Comisiones", d.comisiones]]
    .filter(([, v]) => v)
    .forEach(([k, v]) => {
      const r = document.createElement("div");
      r.innerHTML = "<span></span><b></b>";
      r.querySelector("span").textContent = k;
      r.querySelector("b").textContent = cop(v);
      desglose.append(r);
    });
  cont.append(desglose);

  // Mientras se paga uno, lo que se va acumulando para el siguiente.
  if (ext.estado === "abierto" || ext.estado === "vencido") {
    const sig = mesSiguiente(mExt), ds = tarjetaDelMes(sig);
    if (ds.total) {
      const nota = document.createElement("div");
      nota.className = "siguiente-extracto";
      nota.textContent = "Siguiente extracto: " + cop(ds.total) + " · corta el " + diaCorto(corteDe(sig))
        + ", vence el " + diaCorto(fechaDePago(sig));
      cont.append(nota);
    }
  }

  const botones = document.createElement("div");
  botones.className = "edicion-botones";
  if (d.pago) {
    const deshacer = document.createElement("button");
    deshacer.className = "ghost";
    deshacer.textContent = "Desmarcar pago";
    deshacer.onclick = () => { delete estado.tarjeta.pagos[mExt]; render(); guardar(); };
    botones.append(deshacer);
  } else if (d.total) {
    const pagar = document.createElement("button");
    pagar.className = pagandoTarjeta ? "" : "primario";
    pagar.textContent = pagandoTarjeta ? "Cancelar" : ext.estado === "en curso" ? "Pagar por adelantado" : "Registrar pago";
    pagar.onclick = () => { pagandoTarjeta = !pagandoTarjeta; render(); };
    botones.append(pagar);
  }
  cont.append(botones);

  if (pagandoTarjeta && !d.pago) cont.append(formularioPagoTarjeta(d, mExt));
}

function formularioPagoTarjeta(d, mExt) {
  const caja = document.createElement("div");
  caja.className = "retiro";
  caja.innerHTML = `
    <div><label>Cuánto pagó</label><input class="rMonto" type="number" min="0" step="1000"></div>
    <div><label>Fecha</label><input class="rFecha" type="date"></div>
    <button class="primario rOk">Pagar</button>
    <small>Si el extracto dice otra cifra, escriba la del extracto: esa es la que sale del saldo.</small>`;
  const monto = caja.querySelector(".rMonto");
  const fecha = caja.querySelector(".rFecha");
  monto.value = d.total;
  fecha.value = mesDe(hoy()) === mes ? hoy() : fechaDePago(mExt);
  const confirmar = () => {
    const valor = Number(monto.value);
    if (!valor || valor <= 0) { monto.focus(); return; }
    // Se guarda en el extracto que paga; sale del saldo del mes de la fecha en que se pagó.
    estado.tarjeta.pagos[mExt] = { fecha: fecha.value || fechaDePago(mExt), monto: valor };
    pagandoTarjeta = false;
    render(); guardar();
  };
  caja.querySelector(".rOk").onclick = confirmar;
  monto.addEventListener("keydown", e => { if (e.key === "Enter") confirmar(); });
  return caja;
}

function renderCuotasTarjeta(d) {
  const cont = $("tarjetaCuotas");
  cont.innerHTML = "";
  if (!d.cuotas.length) {
    cont.innerHTML = '<div class="vacio">Sin cuotas en el extracto de este mes.</div>';
    return;
  }
  d.cuotas
    .sort((a, b) => (b.capital + b.interes) - (a.capital + a.interes))
    .forEach(q => {
      const c = q.compra;
      const fila = document.createElement("div");
      fila.className = "fila";
      const detalle = [(c.tipo === "avance" ? "Avance" : c.categoria),
                       "cuota " + q.numero + " de " + c.cuotas];
      if (q.interes) detalle.push(cop(q.interes) + " de interés");
      if (q.comision) detalle.push(cop(q.comision) + " de comisión");
      fila.append(textoFila(c.concepto || "Compra del " + diaCorto(c.fecha), detalle.join(" · ")),
                  valorFila(cop(q.capital + q.interes + q.comision)));
      cont.append(fila);
    });
}

function renderDeudasTarjeta() {
  const cont = $("tarjetaDeudas");
  cont.innerHTML = "";
  const fin = mes + "-32";
  const todas = estado.compras
    .filter(c => c.fecha <= fin)
    .map(c => ({ c, p: pendienteCompra(c) }))
    .sort((a, b) => b.c.fecha.localeCompare(a.c.fecha));
  const vivas = todas.filter(x => x.p.capital > 0);
  const pagadas = todas.filter(x => x.p.capital <= 0);
  // Si lo que se edita ya está pagado, la lista de pagadas se abre para mostrar el formulario.
  if (pagadas.some(x => x.c.id === editandoCompra)) verCompraPagadas = true;

  if (!vivas.length) cont.innerHTML = '<div class="vacio">No debe nada en la tarjeta. Anote arriba las compras que haga con ella.</div>';
  vivas.forEach(x => cont.append(filaCompra(x.c, x.p)));

  const total = vivas.reduce((s, x) => s + x.p.capital, 0);
  const intereses = vivas.reduce((s, x) => s + x.p.interes, 0);
  $("deudaResumen").textContent = total ? cop(total) + (intereses ? " + " + cop(intereses) + " de interés" : "") : "";

  const caja = $("tarjetaPagadasCaja");
  caja.innerHTML = "";
  if (!pagadas.length) return;
  const btn = document.createElement("button");
  btn.className = "ghost";
  btn.textContent = (verCompraPagadas ? "Ocultar" : "Ver") + " " + pagadas.length + " compra(s) ya pagadas";
  btn.onclick = () => { verCompraPagadas = !verCompraPagadas; render(); };
  caja.append(btn);
  if (verCompraPagadas) pagadas.forEach(x => caja.append(filaCompra(x.c, x.p, true)));
}

function filaCompra(c, p, pagada) {
  if (editandoCompra === c.id) return formularioCompra(c, p);
  const fila = document.createElement("div");
  fila.className = "fila" + (pagada ? " tenue" : "");

  const marca = document.createElement("span");
  marca.className = "badge tarjeta";
  marca.textContent = c.tipo === "avance" ? "Avance" : c.cuotas === 1 ? "1 cuota" : c.cuotas + " cuotas";

  const detalle = [diaCorto(c.fecha), c.tipo === "avance" ? "a la cuenta" : c.categoria, cop(c.monto)];
  if (pagada) detalle.push(c.liquidada ? "liquidada" : "pagada");
  else {
    detalle.push(p.pagadas + " de " + p.plan.length + " pagadas" + (c.pagadasAntes ? " (" + c.pagadasAntes + " por fuera)" : ""));
    // En qué extracto va su próxima cuota, y si ese extracto ya cortó.
    const prox = p.pendientes[0];
    if (prox) detalle.push((corteDe(prox.mes) <= hoy() ? "en el extracto ya cortado, vence el " : "va en el extracto del ")
                           + diaCorto(fechaDePago(prox.mes)));
    if (c.liquidada) detalle.push("se liquida en " + nombreMes(c.liquidada).toLowerCase());
  }

  fila.append(marca, textoFila(c.concepto || "Compra", detalle.join(" · ")),
              valorFila(pagada ? cop(c.monto) : "debe " + cop(p.capital)));

  if (!pagada && p.pendientes.length > 1 && !c.liquidada) {
    const liquidar = document.createElement("button");
    liquidar.className = "ghost";
    liquidar.textContent = "Pagar todo";
    liquidar.title = "Paga el saldo completo en el extracto de " + nombreMes(p.pendientes[0].mes);
    liquidar.onclick = () => {
      const m = p.pendientes[0].mes;
      if (!confirm(`Pagar los ${cop(p.capital)} que faltan de "${c.concepto}" en el extracto de ${nombreMes(m)}? `
                   + "Así deja de generar intereses los meses siguientes.")) return;
      c.liquidada = m;
      render(); guardar();
    };
    fila.append(liquidar);
  } else if (c.liquidada && !pagada) {
    const deshacer = document.createElement("button");
    deshacer.className = "ghost";
    deshacer.textContent = "Volver a cuotas";
    deshacer.onclick = () => { c.liquidada = null; render(); guardar(); };
    fila.append(deshacer);
  }

  // Para la cuota que se pagó antes de que llegara su extracto, o por fuera de la libreta.
  if (!pagada && p.pendientes.length && !c.liquidada) {
    const siguiente = p.pendientes[0];
    const pague = document.createElement("button");
    pague.className = "ghost";
    pague.textContent = "Ya pagué la cuota " + siguiente.numero;
    pague.title = "Marca pagada la cuota " + siguiente.numero + " de " + c.cuotas + " (" + cop(siguiente.capital + siguiente.interes + siguiente.comision) + ")";
    pague.onclick = () => {
      if (!confirm(`¿Marcar pagada la cuota ${siguiente.numero} de ${c.cuotas} de "${c.concepto}" (${cop(siguiente.capital + siguiente.interes + siguiente.comision)})?\n\n`
        + `Sale del extracto de ${nombreMes(siguiente.mes)} y de la deuda. No cambia su saldo: si esa plata salió de su cuenta y no la ha anotado, anótela como gasto.`)) return;
      c.pagadasAntes = siguiente.numero;
      render(); guardar();
    };
    fila.append(pague);
  }

  const editar = document.createElement("button");
  editar.className = "ghost";
  editar.textContent = "Editar";
  editar.onclick = () => abrirEdicionCompra(c.id);
  fila.append(editar);

  const borrar = document.createElement("button");
  borrar.className = "ghost";
  borrar.textContent = "Borrar";
  borrar.onclick = () => {
    if (p.pagadas && !confirm(`"${c.concepto}" ya tiene cuotas en extractos pagados. Borrarla cambia el cálculo de esos meses, aunque lo pagado se conserva. ¿Continuar?`)) return;
    estado.compras = estado.compras.filter(x => x.id !== c.id);
    render(); guardar();
  };
  fila.append(borrar);
  return fila;
}

/** Abre la edición de una compra desde cualquier parte: la tarjeta, los avances o los movimientos. */
function abrirEdicionCompra(id) {
  const c = estado.compras.find(x => x.id === id);
  if (!c) return;
  editandoCompra = id;
  // La lista de compras muestra lo comprado hasta el mes visible.
  if (mesDe(c.fecha) > mes) irAMes(mesDe(c.fecha));
  irAVista("tarjeta");
  render();
  const caja = document.querySelector(".edicion-compra");
  if (caja) { caja.scrollIntoView({ behavior: "smooth", block: "center" }); caja.querySelector(".eConcepto").focus(); }
}

/**
 * Editar una compra o avance. Cambiar el monto, las cuotas, la fecha o la tasa
 * recalcula su plan de pagos; los pagos de extractos ya registrados conservan
 * lo que se pagó de verdad.
 */
function formularioCompra(c, p) {
  const caja = document.createElement("div");
  caja.className = "edicion edicion-compra";
  caja.innerHTML = `
    <div class="edicion-campos">
      <div><label>Tipo</label><select class="eTipo">
        <option value="compra">Compra</option><option value="avance">Avance a la cuenta</option></select></div>
      <div><label>Qué fue</label><input class="eConcepto"></div>
      <div class="eCampoCat"><label>Categoría</label><select class="eCat"></select></div>
      <div><label>Monto</label><input class="eMonto" type="number" min="0" step="1000"></div>
      <div><label>Cuotas</label><input class="eCuotas" type="number" min="1" max="48" step="1"></div>
      <div><label>Fecha</label><input class="eFecha" type="date"></div>
      <div><label>Tasa E.A. %</label><input class="eTasa" type="number" min="0" step="0.01"></div>
      <div><label>Cuotas ya pagadas</label><input class="ePagadas" type="number" min="0" step="1"></div>
    </div>
    <div class="edicion-botones">
      <button class="primario eGuardar">Guardar</button>
      <button class="eCancelar">Cancelar</button>
    </div>
    <p class="nota eNota"></p>`;
  const q = s => caja.querySelector(s);
  llenarOpciones(q(".eCat"), CATEGORIAS);
  q(".eTipo").value = c.tipo;
  q(".eConcepto").value = c.concepto;
  q(".eCat").value = CATEGORIAS.includes(c.categoria) ? c.categoria : "Otros";
  q(".eMonto").value = c.monto;
  q(".eCuotas").value = c.cuotas;
  q(".eFecha").value = c.fecha;
  q(".eTasa").value = c.tasaEA;
  q(".ePagadas").value = c.pagadasAntes || 0;

  const refrescar = () => {
    const avance = q(".eTipo").value === "avance";
    q(".eCampoCat").hidden = avance;
    const partes = [];
    if (p.pagadas) partes.push("Ya tiene " + p.pagadas + (p.pagadas === 1 ? " cuota" : " cuotas")
      + " en extractos pagados: si cambia el monto, las cuotas o la fecha, el plan se recalcula, pero lo que registró como pagado se conserva.");
    if (avance && c.tipo !== "avance") partes.push("Al volverlo avance se le suma la comisión de " + cop(estado.tarjeta.comisionAvance) + " y paga intereses desde la primera cuota.");
    if (!avance && c.tipo === "avance") partes.push("Al volverlo compra se le quita la comisión del avance.");
    partes.push("La tasa es la de esta compra; cambiar la de la tarjeta no la afecta.");
    partes.push("Cuotas ya pagadas: las que pagó por fuera de la libreta (por adelantado o antes de usarla). "
      + "Salen de los extractos y de la deuda, y no mueven el saldo.");
    q(".eNota").textContent = partes.join(" ");
  };
  q(".eTipo").onchange = refrescar;
  refrescar();

  const guardarCambios = () => {
    const monto = Number(q(".eMonto").value), cuotas = Math.round(Number(q(".eCuotas").value));
    const tipo = q(".eTipo").value, fecha = q(".eFecha").value;
    if (!monto || monto <= 0) { q(".eMonto").focus(); return; }
    if (!(cuotas >= 1)) { q(".eCuotas").focus(); return; }
    if (tipo === "avance" && cuotas > TARJETA_REF.cuotasAvance) {
      alert("Un avance se puede diferir máximo a " + TARJETA_REF.cuotasAvance + " cuotas.");
      q(".eCuotas").focus(); return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { q(".eFecha").focus(); return; }
    if (tipo !== c.tipo) c.comision = tipo === "avance" ? estado.tarjeta.comisionAvance : 0;
    Object.assign(c, {
      tipo, fecha, monto: Math.round(monto), cuotas,
      concepto: q(".eConcepto").value.trim() || (tipo === "avance" ? "Avance a la cuenta" : ""),
      categoria: tipo === "avance" ? "Otros" : q(".eCat").value,
      tasaEA: Number(q(".eTasa").value) || 0,
      pagadasAntes: Math.min(Math.max(Math.round(Number(q(".ePagadas").value) || 0), 0), cuotas)
    });
    editandoCompra = null;
    render(); guardar();
  };
  q(".eGuardar").onclick = guardarCambios;
  [".eConcepto", ".eMonto", ".eCuotas"].forEach(s =>
    q(s).addEventListener("keydown", e => { if (e.key === "Enter") guardarCambios(); }));
  q(".eCancelar").onclick = () => { editandoCompra = null; render(); };
  return caja;
}

/** Los avances aparte: plata que llega a la cuenta y se paga con intereses desde el primer mes. */
function renderAvances() {
  const cont = $("tarjetaAvances");
  cont.innerHTML = "";
  const avances = estado.compras.filter(c => c.tipo === "avance")
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!avances.length) {
    cont.innerHTML = '<div class="vacio">Sin avances. Si pasa plata de la tarjeta a su cuenta, anótelo arriba como "Avance a la cuenta".</div>';
    $("avancesResumen").textContent = "";
    return;
  }
  let debe = 0, costo = 0;
  avances.forEach(c => {
    const p = pendienteCompra(c);
    const total = p.plan.reduce((s, q) => s + q.interes + q.comision, 0);
    debe += p.capital;
    costo += total;
    const fila = document.createElement("div");
    fila.className = "fila" + (p.capital ? "" : " tenue");
    const marca = document.createElement("span");
    marca.className = "badge tarjeta";
    marca.textContent = c.cuotas + (c.cuotas === 1 ? " cuota" : " cuotas");
    fila.append(marca,
      textoFila(c.concepto || "Avance a la cuenta",
        diaCorto(c.fecha) + " · sacó " + cop(c.monto) + " · le cuesta " + cop(total) + " en intereses y comisión"
        + " · " + p.pagadas + " de " + p.plan.length + " pagadas"),
      valorFila(p.capital ? "debe " + cop(p.capital) : "pagado"));
    const editar = document.createElement("button");
    editar.className = "ghost";
    editar.textContent = "Editar";
    editar.onclick = () => abrirEdicionCompra(c.id);
    fila.append(editar);
    cont.append(fila);
  });
  $("avancesResumen").textContent = debe ? "debe " + cop(debe) + " · cuestan " + cop(costo) : "cuestan " + cop(costo);
}

function renderProyeccionTarjeta() {
  const cuerpo = $("cuerpoProyeccion");
  cuerpo.innerHTML = "";
  for (let k = 0; k < 6; k++) {
    const m = mesMas(mes, k);
    const d = tarjetaDelMes(m);
    const tr = document.createElement("tr");
    if (k === 0) tr.className = "actual";
    [nombreMes(m) + (d.pago ? " ✓" : ""), cop(d.capital), cop(d.interes),
     cop(d.manejo + d.comisiones), cop(d.total), cop(deudaFutura(m))].forEach((txt, i) => {
      const td = document.createElement("td");
      td.textContent = txt;
      if (i) td.className = "num";
      tr.append(td);
    });
    cuerpo.append(tr);
  }
}

/** Capital que quedará después del extracto de m, suponiendo que se paga todo a tiempo. */
function deudaFutura(m) {
  let deuda = 0;
  estado.compras.forEach(c => planCompra(c).forEach(q => { if (q.mes > m && !q.previa) deuda += q.capital; }));
  return deuda;
}

/** Cuánto saldría la compra antes de anotarla. */
function previaCompra() {
  const monto = Number($("cMonto").value);
  const cuotas = Math.max(1, Math.round(Number($("cCuotas").value) || 1));
  const tipo = $("cTipo").value;
  $("campoCCat").hidden = tipo === "avance";
  if (!monto || !estado.tarjeta) { $("compraPrevia").textContent = tipo === "avance"
      ? "El avance llega a su cuenta y suma al saldo del mes. Se paga hasta en 24 cuotas, con intereses desde la primera."
      : "A una cuota no paga intereses. A más cuotas, el interés se cobra sobre lo que vaya debiendo."; return; }
  const plan = planCompra({ id: "previa", fecha: $("cFecha").value || diaDentroDe(mes), tipo, monto, cuotas,
                            tasaEA: estado.tarjeta.tasaEA,
                            comision: tipo === "avance" ? estado.tarjeta.comisionAvance : 0, liquidada: null });
  cachePlanes.delete("previa");
  const interes = plan.reduce((s, q) => s + q.interes + q.comision, 0);
  const primera = plan[0];
  $("compraPrevia").textContent = "Primera cuota de " + cop(primera.capital + primera.interes + primera.comision)
    + " en el extracto de " + nombreMes(primera.mes).toLowerCase()
    + (interes ? ". Le costará " + cop(interes) + " en intereses y comisiones, " + cop(monto + interes) + " en total."
               : ", sin intereses.");
}

function agregarCompra(datos) {
  if (!estado.tarjeta) {
    alert("Primero configure la tarjeta en la sección Tarjeta.");
    irAVista("tarjeta");
    return false;
  }
  const avance = datos.tipo === "avance";
  if (avance && Number(datos.cuotas) > TARJETA_REF.cuotasAvance) {
    alert("Un avance se puede diferir máximo a " + TARJETA_REF.cuotasAvance + " cuotas.");
    return false;
  }
  estado.compras.push(normalizarCompra({
    ...datos, id: uid(), tasaEA: estado.tarjeta.tasaEA,
    comision: datos.tipo === "avance" ? estado.tarjeta.comisionAvance : 0
  }));
  return true;
}

function agregarCompraDelPanel() {
  const monto = Number($("cMonto").value);
  if (!monto || monto <= 0) { $("cMonto").focus(); return; }
  const tipo = $("cTipo").value;
  const fecha = $("cFecha").value || diaDentroDe(mes);
  agregarCompra({
    fecha, tipo, monto, cuotas: $("cCuotas").value,
    concepto: $("cDesc").value.trim() || (tipo === "avance" ? "Avance a la cuenta" : ""),
    categoria: tipo === "avance" ? "Otros" : $("cCat").value
  });
  if (mesDe(fecha) !== mes) mes = mesDe(fecha);
  $("cDesc").value = "";
  $("cMonto").value = "";
  $("cCuotas").value = 1;
  render(); guardar();
}

function iniciarTarjeta() {
  llenarOpciones($("cCat"), CATEGORIAS);
  $("cCat").value = "Alimentación";
  $("cFecha").value = hoy();
  $("btnTarjeta").onclick = guardarTarjeta;
  $("btnTarjetaCancelar").onclick = () => { editandoTarjeta = false; render(); };
  $("btnCompra").onclick = agregarCompraDelPanel;
  ["cDesc", "cMonto", "cCuotas"].forEach(id =>
    $(id).addEventListener("keydown", e => { if (e.key === "Enter") agregarCompraDelPanel(); }));
  ["cMonto", "cCuotas", "cTipo", "cFecha"].forEach(id => $(id).addEventListener("input", previaCompra));
}
