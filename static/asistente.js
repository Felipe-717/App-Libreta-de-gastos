"use strict";

/*
 * Asistente con la API de OpenAI. El servidor solo reenvía cada consulta con la
 * clave del perfil; todo lo demás pasa aquí: se arma la consulta, y cuando el
 * modelo pide una herramienta se ejecuta sobre los datos del navegador con las
 * mismas funciones que pintan la app, así sus cifras son las de la pantalla.
 *
 * Nada se anota sin confirmar: lo que el modelo entiende llega como propuesta
 * editable, y solo lo marcado se guarda.
 */

let ia = { configurada: false, modelo: "" };
let propuestas = [];
let historialChat = [];
let conversando = false;
let contextoAyuda = null;
const analisisPorMes = {};

/* ------------------------------------------------------------ conexión */
async function consultarIA(payload) {
  const r = await fetch("/api/ia", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Libreta-Sesion": contextoSesion }, body: JSON.stringify(payload)
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || "error " + r.status);
  return datos;
}

/** El texto de la respuesta: la API REST no trae output_text, se junta a mano. */
function textoDe(resp) {
  return (resp.output || [])
    .filter(o => o.type === "message")
    .flatMap(o => o.content || [])
    .filter(c => c.type === "output_text")
    .map(c => c.text).join("\n").trim();
}

function jsonDe(resp) {
  const t = textoDe(resp);
  try { return JSON.parse(t); } catch (e) { throw new Error("El modelo no devolvió un JSON válido"); }
}

async function revisarIA() {
  let errorEstado = "";
  try {
    const respuesta = await fetch("/api/ia/estado", { cache: "no-store", headers: { "X-Libreta-Sesion": contextoSesion } });
    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.error || "Error " + respuesta.status);
    ia = datos;
  } catch (e) { ia = { configurada: false }; errorEstado = e.message; }
  document.querySelectorAll("[data-solo-ia]").forEach(e => { e.hidden = !ia.configurada; });
  $("iaSinClave").hidden = ia.configurada;
  $("iaConClave").hidden = !ia.configurada;
  $("claveEstado").textContent = errorEstado ? "No se pudo comprobar: " + errorEstado : ia.configurada ? "Configurada" + (ia.modelo ? " · " + ia.modelo : "") : "Sin configurar";
  $("iaModelo").textContent = ia.modelo || "";
  $("analisisModelo").textContent = ia.modelo || "";
}

const hoyLargo = () => new Date().toLocaleDateString("es-CO",
  { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " (" + hoy() + ")";

const cargando = '<span class="cargando"><i></i><i></i><i></i></span>';

/* ================================================= anotar con palabras */
const TIPOS_IA = {
  gasto: "Gasto", compra_tarjeta: "Compra con tarjeta", avance: "Avance a la cuenta",
  ingreso: "Ingreso", prestamo: "Préstamo a alguien", abono_prestamo: "Le devolvieron",
  aporte: "Aporte a ahorro", retiro: "Retiro de ahorro"
};

function esquemaMovimientos() {
  const categorias = [...new Set([...CATEGORIAS, ...ORIGENES])];
  return {
    type: "object", additionalProperties: false, required: ["items", "nota"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["tipo", "concepto", "categoria", "monto", "fecha", "cuotas", "persona", "ahorro", "fecha_acordada"],
          properties: {
            tipo: { type: "string", enum: Object.keys(TIPOS_IA) },
            concepto: { type: "string", description: "Descripción corta, como la escribiría la persona" },
            categoria: { type: ["string", "null"], enum: [...categorias, null],
                         description: "Para gastos y compras, una de las categorías; para ingresos, un origen" },
            monto: { type: "number", description: "Pesos colombianos, sin decimales" },
            fecha: { type: "string", description: "AAAA-MM-DD" },
            cuotas: { type: ["integer", "null"], description: "Solo compras con tarjeta y avances; 1 si no se dice" },
            persona: { type: ["string", "null"], description: "Solo préstamos y abonos a préstamos" },
            ahorro: { type: ["string", "null"], description: "Nombre del bolsillo de ahorro, para aportes y retiros" },
            fecha_acordada: { type: ["string", "null"], description: "Préstamos: fecha en que quedó de pagar, AAAA-MM-DD" }
          }
        }
      },
      nota: { type: ["string", "null"], description: "Dudas o supuestos que la persona debería revisar, o null" }
    }
  };
}

function instruccionesAnotar() {
  const pendientes = [...new Set(estado.prestamos.filter(p => estadoPrestamo(p).pendiente).map(p => p.persona))];
  return `Convierte lo que la persona cuenta en movimientos para su libreta de gastos en Colombia.
Hoy es ${hoyLargo()}. Resuelve fechas relativas ("ayer", "el viernes") contra hoy, siempre hacia atrás salvo fechas acordadas de pago.
Montos en pesos colombianos: "mil" o "lucas" son miles, "palo" o "millón" son millones ("25 mil" = 25000, "1,5 palos" = 1500000).
Tipos:
- gasto: pagado con débito, efectivo, Nequi, transferencia o sin decir el medio.
- compra_tarjeta: cuando dice tarjeta, TC, crédito o "a cuotas". Cuotas = las que diga, o 1.
- avance: plata que pasó de la tarjeta de crédito a la cuenta.
- ingreso: plata que le entró (sueldo, venta, regalo, reembolso).
- prestamo: plata que la persona le prestó a alguien. persona = a quién; fecha_acordada si dice cuándo le paga.
- abono_prestamo: alguien le devolvió plata prestada. persona = quién.
- aporte / retiro: movimientos con un bolsillo de ahorro.
Categorías de gasto: ${CATEGORIAS.join(", ")}. Orígenes de ingreso: ${ORIGENES.join(", ")}.
Tarjeta de crédito configurada: ${estado.tarjeta ? estado.tarjeta.nombre : "ninguna"}.
Bolsillos de ahorro: ${estado.ahorros.map(a => a.concepto).join(", ") || "ninguno"}.
Personas que le deben: ${pendientes.join(", ") || "ninguna"}. Usa el mismo nombre si se refiere a alguna de ellas.
Un movimiento por cosa mencionada. No inventes montos: si falta uno, omite ese movimiento y explícalo en nota.`;
}

function instruccionesDocumento() {
  return instruccionesAnotar() + `

Ahora recibes una imagen o un PDF.
- Si es un extracto de tarjeta de crédito: un item por cada compra o avance del periodo (compra_tarjeta o avance), con la fecha de la transacción, el valor original de la compra y el número total de cuotas al que se difirió. Omite pagos, abonos, intereses, cuota de manejo, saldos y cargos del banco: la libreta ya los calcula. Concepto = el comercio, legible.
- Si es un recibo, factura o comprobante: normalmente un solo gasto por el total, con la fecha del documento. Si dice que se pagó con tarjeta de crédito, es compra_tarjeta.
- Si es un comprobante de transferencia recibida, es ingreso.
Si algo no se lee bien, dilo en nota.`;
}

async function interpretarTexto() {
  const texto = $("iaTexto").value.trim();
  if (!texto) { $("iaTexto").focus(); return; }
  await pedirPropuestas([{ role: "user", content: texto }], instruccionesAnotar(), "low");
}

async function leerArchivo(archivo) {
  if (!archivo) return;
  if (archivo.size > 30e6) { $("iaEstado").textContent = "El archivo pesa más de 30 MB."; return; }
  $("iaEstado").innerHTML = cargando + " Leyendo " + esc(archivo.name) + "...";
  try {
    const parte = archivo.type === "application/pdf"
      ? { type: "input_file", filename: archivo.name, file_data: await comoDataURL(archivo) }
      : { type: "input_image", image_url: await imagenReducida(archivo), detail: "high" };
    const nota = $("iaTexto").value.trim();
    await pedirPropuestas([{ role: "user", content: [
      { type: "input_text", text: nota ? "Indicaciones: " + nota : "Extrae los movimientos de este documento." }, parte
    ] }], instruccionesDocumento(), "medium");
  } catch (e) {
    $("iaEstado").textContent = "No se pudo leer: " + e.message;
  }
}

const comoDataURL = archivo => new Promise((ok, mal) => {
  const lector = new FileReader();
  lector.onload = () => ok(lector.result);
  lector.onerror = () => mal(new Error("no se pudo abrir el archivo"));
  lector.readAsDataURL(archivo);
});

/** Las fotos del celular pesan mucho: se reducen a 2000 px, que sobra para leerlas. */
async function imagenReducida(archivo) {
  const url = await comoDataURL(archivo);
  const img = new Image();
  await new Promise((ok, mal) => { img.onload = ok; img.onerror = () => mal(new Error("imagen no válida")); img.src = url; });
  const escala = Math.min(1, 2000 / Math.max(img.width, img.height));
  if (escala === 1 && archivo.size < 4e6) return url;
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(img.width * escala);
  lienzo.height = Math.round(img.height * escala);
  lienzo.getContext("2d").drawImage(img, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL("image/jpeg", 0.88);
}

async function pedirPropuestas(input, instructions, esfuerzo) {
  if (propuestas.length) { $("iaEstado").textContent = "Confirme o descarte las propuestas pendientes."; return; }
  $("btnIaInterpretar").disabled = true;
  if (!$("iaEstado").innerHTML.includes("cargando")) $("iaEstado").innerHTML = cargando + " Interpretando...";
  try {
    const resp = await consultarIA({
      instructions, input, reasoning: { effort: esfuerzo },
      text: { format: { type: "json_schema", name: "movimientos", strict: true, schema: esquemaMovimientos() } }
    });
    const { items, nota } = jsonDe(resp);
    mostrarPropuestas(items, nota);
    $("iaEstado").textContent = items.length
      ? items.length + (items.length === 1 ? " movimiento entendido." : " movimientos entendidos.") + " Revise y confirme."
      : "No encontré movimientos para anotar.";
  } catch (e) {
    $("iaEstado").textContent = "No se pudo: " + e.message;
  } finally {
    $("btnIaInterpretar").disabled = false;
  }
}

function mostrarPropuestas(items, nota) {
  if (propuestas.length) throw new Error("Confirme o descarte las propuestas pendientes");
  propuestas = items.map(x => ({ ...x, id: uid(), marcado: true }));
  propuestas.forEach(revisarPropuesta);
  renderPropuestas(nota);
}

/** Marca lo que ya parece anotado y lo que no se podrá aplicar tal cual. */
function revisarPropuesta(p) {
  p.aviso = "";
  const igual = x => x.fecha === p.fecha && Math.round(x.monto) === Math.round(p.monto);
  const mismaPersona = x => p.persona && x.persona.toLowerCase() === p.persona.trim().toLowerCase();
  const repetida = p.tipo === "compra_tarjeta" || p.tipo === "avance" ? estado.compras.some(igual)
    : p.tipo === "prestamo" ? estado.prestamos.some(x => mismaPersona(x) && igual(x))
    : p.tipo === "abono_prestamo" ? estado.prestamos.some(x => mismaPersona(x) && x.abonos.some(igual))
    : estado.movimientos.some(igual);
  if (repetida) { p.aviso = "Ya hay algo anotado con la misma fecha y monto."; p.marcado = false; }
  if ((p.tipo === "compra_tarjeta" || p.tipo === "avance") && !estado.tarjeta) p.aviso = "Primero configure la tarjeta.";
  if (p.tipo === "abono_prestamo" && !prestamosDe(p.persona).length) {
    p.aviso = "No hay préstamos pendientes a nombre de " + (p.persona || "esa persona") + ".";
  }
}

const prestamosDe = persona => estado.prestamos
  .filter(x => persona && x.persona.toLowerCase() === persona.trim().toLowerCase() && estadoPrestamo(x).pendiente > 0)
  .sort((a, b) => a.fecha.localeCompare(b.fecha));

function renderPropuestas(nota) {
  const cont = $("iaPropuestas");
  cont.innerHTML = "";
  if (!propuestas.length && !nota) return;
  const caja = document.createElement("div");
  caja.className = "propuestas";

  propuestas.forEach(p => {
    const fila = document.createElement("div");
    fila.className = "propuesta" + (p.aviso && !p.marcado ? " repetida" : "");

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = p.marcado;
    chk.onchange = () => { p.marcado = chk.checked; renderPropuestas(nota); };

    const tipo = document.createElement("select");
    Object.entries(TIPOS_IA).forEach(([v, t]) => tipo.add(new Option(t, v)));
    tipo.value = p.tipo;
    tipo.onchange = () => { p.tipo = tipo.value; revisarPropuesta(p); renderPropuestas(nota); };

    const concepto = campo("text", p.concepto, v => { p.concepto = v; });
    const monto = campo("number", p.monto, v => { p.monto = Number(v) || 0; });
    const fecha = campo("date", p.fecha, v => { p.fecha = v; });

    // La cuarta columna cambia según el tipo: categoría, persona o bolsillo.
    let detalle;
    if (p.tipo === "prestamo" || p.tipo === "abono_prestamo") {
      detalle = campo("text", p.persona || "", v => { p.persona = v; });
      detalle.placeholder = "Quién";
      detalle.setAttribute("list", "personas");
    } else if (p.tipo === "aporte" || p.tipo === "retiro") {
      detalle = document.createElement("select");
      detalle.add(new Option("Sin bolsillo", ""));
      estado.ahorros.forEach(a => detalle.add(new Option(a.concepto, a.concepto)));
      detalle.value = estado.ahorros.some(a => a.concepto === p.ahorro) ? p.ahorro : "";
      detalle.onchange = () => { p.ahorro = detalle.value || null; };
    } else if (p.tipo === "avance") {
      detalle = document.createElement("span");
    } else {
      detalle = document.createElement("select");
      const lista = p.tipo === "ingreso" ? ORIGENES : CATEGORIAS;
      lista.forEach(k => detalle.add(new Option(k, k)));
      detalle.value = lista.includes(p.categoria) ? p.categoria : "Otros";
      p.categoria = detalle.value;
      detalle.onchange = () => { p.categoria = detalle.value; };
    }

    const deTarjeta = p.tipo === "compra_tarjeta" || p.tipo === "avance";
    const cuotas = campo("number", deTarjeta ? (p.cuotas || 1) : "", v => { p.cuotas = Number(v) || 1; });
    cuotas.step = "1";
    cuotas.disabled = !deTarjeta;
    cuotas.title = "Cuotas";
    cuotas.placeholder = deTarjeta ? "cuotas" : "—";

    const quitar = document.createElement("button");
    quitar.className = "ghost";
    quitar.textContent = "×";
    quitar.title = "Quitar";
    quitar.onclick = () => { propuestas = propuestas.filter(x => x !== p); renderPropuestas(nota); };

    chk.className = "p-chk";
    quitar.className += " p-quitar";
    monto.placeholder = "monto";
    fila.append(chk, tipo, concepto, monto, fecha, detalle, cuotas, quitar);
    if (p.aviso) {
      const aviso = document.createElement("div");
      aviso.className = "aviso-prop";
      aviso.textContent = p.aviso;
      fila.append(aviso);
    }
    caja.append(fila);
  });

  const pie = document.createElement("div");
  pie.className = "propuestas-pie";
  const marcados = propuestas.filter(p => p.marcado).length;
  if (propuestas.length) {
    const anotar = document.createElement("button");
    anotar.className = "primario";
    anotar.textContent = "Anotar " + marcados + (marcados === 1 ? " movimiento" : " movimientos");
    anotar.disabled = !marcados;
    anotar.onclick = aplicarPropuestas;
    const descartar = document.createElement("button");
    descartar.className = "ghost";
    descartar.textContent = "Descartar";
    descartar.onclick = () => { propuestas = []; renderPropuestas(); $("iaEstado").textContent = ""; };
    pie.append(anotar, descartar);
  }
  if (nota) {
    const n = document.createElement("span");
    n.className = "nota";
    n.textContent = nota;
    pie.append(n);
  }
  caja.append(pie);
  cont.append(caja);
}

function campo(tipo, valor, alCambiar) {
  const i = document.createElement("input");
  i.type = tipo;
  i.value = valor ?? "";
  i.oninput = () => alCambiar(i.value);
  return i;
}

function aplicarPropuestas() {
  let hechos = 0;
  const fallidos = [];
  propuestas.filter(p => p.marcado).forEach(p => {
    if (aplicarUna(p)) hechos++;
    else fallidos.push(p);
  });
  propuestas = fallidos.map(p => ({ ...p, marcado: false }));
  render(); guardar();
  $("iaEstado").textContent = "Se anotaron " + hechos + "." + (fallidos.length ? " " + fallidos.length + " no se pudieron: revíselos abajo." : "");
  $("iaTexto").value = "";
  renderPropuestas();
}

function aplicarUna(p) {
  const monto = Math.round(Number(p.monto) || 0);
  if (!Number.isFinite(monto) || monto <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(p.fecha || "")) { p.aviso = "Ingrese un monto positivo y una fecha."; return false; }
  const concepto = (p.concepto || "").trim();
  switch (p.tipo) {
    case "gasto":
    case "ingreso": {
      const lista = p.tipo === "ingreso" ? ORIGENES : CATEGORIAS;
      estado.movimientos.push({ id: uid(), fecha: p.fecha, tipo: p.tipo, concepto,
        categoria: lista.includes(p.categoria) ? p.categoria : "Otros", monto, ahorro: null, sueldo: null, cuota: null });
      return true;
    }
    case "aporte":
    case "retiro": {
      const bolsillo = estado.ahorros.find(a => p.ahorro && a.concepto.toLowerCase() === p.ahorro.toLowerCase());
      estado.movimientos.push({ id: uid(), fecha: p.fecha, tipo: p.tipo, concepto, categoria: "Otros",
        monto, ahorro: bolsillo ? bolsillo.id : null, sueldo: null, cuota: null });
      return true;
    }
    case "compra_tarjeta":
    case "avance":
      if (!estado.tarjeta) { p.aviso = "Primero configure la tarjeta."; return false; }
      return agregarCompra({ fecha: p.fecha, tipo: p.tipo === "avance" ? "avance" : "compra", monto,
        cuotas: p.cuotas || 1, concepto: concepto || (p.tipo === "avance" ? "Avance a la cuenta" : ""),
        categoria: p.tipo === "avance" ? "Otros" : (CATEGORIAS.includes(p.categoria) ? p.categoria : "Otros") });
    case "prestamo":
      if (!p.persona) { p.aviso = "Falta a quién se le prestó."; return false; }
      estado.prestamos.push(normalizarPrestamo({ persona: p.persona, concepto, monto, fecha: p.fecha,
        acordada: p.fecha_acordada || null }));
      return true;
    case "abono_prestamo": {
      // El abono va al préstamo más viejo; si sobra, sigue con el siguiente.
      const lista = prestamosDe(p.persona);
      if (!lista.length) { p.aviso = "No hay préstamos pendientes a nombre de " + (p.persona || "esa persona") + "."; return false; }
      let resta = monto;
      lista.forEach((x, i) => {
        if (resta <= 0) return;
        const parte = i === lista.length - 1 ? resta : Math.min(resta, estadoPrestamo(x).pendiente);
        x.abonos.push({ id: uid(), fecha: p.fecha, monto: parte, nota: concepto });
        resta -= parte;
      });
      return true;
    }
  }
  return false;
}

/* =============================================== herramientas de consulta */
const nulo = t => ({ type: [t, "null"] });
const herramienta = (name, description, props) => ({
  type: "function", name, description, strict: true,
  parameters: { type: "object", additionalProperties: false, required: Object.keys(props), properties: props }
});

const HERRAMIENTAS = [
  herramienta("resumen_mes", "Cifras de un mes: saldo, entradas, salidas, lo libre, lo pendiente, consumo por categoría, tarjeta, deudas y ahorro.",
    { mes: { ...nulo("string"), description: "AAAA-MM; null = el mes que se está viendo en la app" } }),
  herramienta("buscar_movimientos", "Lista movimientos entre dos fechas: gastos, ingresos, pagos de fijos, compras con tarjeta, avances, pagos del extracto, préstamos y abonos.",
    { desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" },
      texto: { ...nulo("string"), description: "Filtra por texto en el concepto" },
      categoria: { ...nulo("string"), description: "Filtra por categoría" },
      clase: { ...nulo("string"), enum: ["gasto", "ingreso", "fijo", "tarjeta", "prestamo", "ahorro", null] } }),
  herramienta("estado_tarjeta", "La tarjeta de crédito: tasas, cupo, deuda, compras por pagar con sus intereses pendientes y los extractos de los próximos 6 meses.", {}),
  herramienta("simular_compra_tarjeta", "Calcula cuánto costaría una compra o avance con la tarjeta: cuota por mes, intereses y total.",
    { monto: { type: "number" }, cuotas: { type: "integer" }, tipo: { type: "string", enum: ["compra", "avance"] } }),
  herramienta("prestamos", "La plata prestada: a quién, cuánto, cuánto ha devuelto, fecha acordada y si está vencido.", {}),
  herramienta("proyeccion_saldo", "Saldo estimado de los próximos meses con sueldo previsto, fijos, tarjeta y gasto suelto promedio.",
    { meses: { type: "integer", description: "Entre 1 y 12" } }),
  herramienta("historia", "Entradas, salidas, cierre y consumo de cada mes con registros.", {}),
  herramienta("fijos_y_sueldo", "Gastos fijos y sueldos de un mes, con lo pagado y lo pendiente.",
    { mes: { ...nulo("string"), description: "AAAA-MM; null = el mes que se está viendo" } })
];

function datosMes(m) {
  const c = resumenMes(m);
  const t = tarjetaDelMes(m);
  const consumo = consumoPorCategoria(m);
  return {
    mes: m, nombre: nombreMes(m), saldo_inicial: c.inicial, entradas: c.entradas, salidas: c.salidas,
    saldo: c.saldo, libre_despues_de_pendientes: c.libre, falta_pagar: c.pendiente,
    ingresos: c.ingresos, sueldo_previsto: c.sueldoEsperado, sueldo_por_recibir: c.porRecibir,
    consumo_total: consumo.pares.reduce((s, [, v]) => s + v, 0),
    consumo_por_categoria: Object.fromEntries(consumo.pares), comprado_con_tarjeta: consumo.conTarjeta,
    extracto_tarjeta: { total: t.total, capital: t.capital, intereses: t.interes, manejo: t.manejo,
                        comisiones: t.comisiones, pagado: t.pago ? t.pago.monto : null },
    deuda_tarjeta: c.deudaTarjeta, le_deben: c.teDeben, prestado_en_el_mes: c.prestado,
    ahorro_acumulado: c.ahorroTotal, abonado_a_ahorro: c.ahorroAbonado, meta_ahorro: c.metaAhorro
  };
}

function movimientosEntre(desde, hasta) {
  const lista = [];
  const dentro = f => f >= desde && f <= hasta;
  estado.movimientos.filter(x => dentro(x.fecha)).forEach(x => lista.push({
    fecha: x.fecha, clase: x.tipo === "aporte" || x.tipo === "retiro" ? "ahorro" : x.tipo,
    tipo: x.tipo, concepto: x.concepto, categoria: x.categoria, monto: x.monto }));
  estado.fijos.forEach(f => Object.entries(f.pagado).forEach(([m, fecha]) => {
    if (dentro(fecha)) lista.push({ fecha, clase: "fijo", tipo: "pago de fijo", concepto: f.concepto,
                                    categoria: f.categoria, monto: montoVigente(f, m) });
  }));
  estado.compras.filter(x => dentro(x.fecha)).forEach(x => lista.push({
    fecha: x.fecha, clase: "tarjeta", tipo: x.tipo === "avance" ? "avance a la cuenta" : "compra con tarjeta",
    concepto: x.concepto, categoria: x.categoria, monto: x.monto, cuotas: x.cuotas }));
  if (estado.tarjeta) Object.entries(estado.tarjeta.pagos).forEach(([m, p]) => {
    if (dentro(p.fecha)) lista.push({ fecha: p.fecha, clase: "tarjeta", tipo: "pago del extracto",
                                      concepto: "Extracto de " + nombreMes(m), categoria: "Deudas", monto: p.monto });
  });
  estado.prestamos.forEach(p => {
    if (dentro(p.fecha)) lista.push({ fecha: p.fecha, clase: "prestamo", tipo: "préstamo dado",
                                      concepto: p.persona + (p.concepto ? " · " + p.concepto : ""), categoria: null, monto: p.monto });
    p.abonos.filter(a => dentro(a.fecha)).forEach(a => lista.push({ fecha: a.fecha, clase: "prestamo",
      tipo: "le devolvieron", concepto: p.persona, categoria: null, monto: a.monto }));
  });
  return lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function ejecutarHerramienta(nombre, a) {
  const mesDe_ = m => (m && /^\d{4}-\d{2}$/.test(m)) ? m : mes;
  switch (nombre) {
    case "proponer_movimientos":
      if (propuestas.length) return { error: "Hay propuestas pendientes; confirme o descarte antes de crear otras." };
      if (!Array.isArray(a.items) || !a.items.length) return { error: "No hay movimientos para proponer." };
      mostrarPropuestas(a.items, a.nota);
      $("iaEstado").textContent = "Revise y confirme las propuestas.";
      $("iaPropuestas").scrollIntoView({ behavior: "smooth", block: "center" });
      return { estado: "Propuestas mostradas; todavía no se ha registrado nada. La persona debe confirmar o descartar." };
    case "resumen_mes": return datosMes(mesDe_(a.mes));
    case "buscar_movimientos": {
      let lista = movimientosEntre(a.desde, a.hasta);
      if (a.texto) lista = lista.filter(x => (x.concepto || "").toLowerCase().includes(a.texto.toLowerCase()));
      if (a.categoria) lista = lista.filter(x => (x.categoria || "").toLowerCase() === a.categoria.toLowerCase());
      if (a.clase) lista = lista.filter(x => x.clase === a.clase);
      return { cantidad: lista.length, total: lista.reduce((s, x) => s + x.monto, 0),
               movimientos: lista.slice(-120), recortado: lista.length > 120 };
    }
    case "estado_tarjeta": {
      const t = estado.tarjeta;
      if (!t) return { configurada: false };
      cachePlanes.clear();
      const vivas = estado.compras.map(c => ({ c, p: pendienteCompra(c) })).filter(x => x.p.capital > 0);
      return {
        nombre: t.nombre, tasa_efectiva_anual: t.tasaEA, tasa_mensual: +(100 * tasaMensual(t.tasaEA)).toFixed(4),
        cuota_manejo: manejoDe(mes), dia_corte: t.diaCorte, dia_pago: t.diaPago, cupo: t.cupo,
        deuda_capital: deudaTarjeta(mesDe(hoy())), comision_avance: t.comisionAvance,
        compras_por_pagar: vivas.map(({ c, p }) => ({ concepto: c.concepto, tipo: c.tipo, fecha: c.fecha, monto: c.monto,
          cuotas: c.cuotas, cuotas_pagadas: p.pagadas, debe_capital: p.capital, intereses_pendientes: p.interes,
          primer_extracto: p.plan[0].mes, ultimo_extracto: p.plan[p.plan.length - 1].mes })),
        extracto_para_pagar_hoy: (ex => ex && { vence: fechaDePago(ex.mes), corte: corteDe(ex.mes), estado: ex.estado,
                                               total: ex.d.total, pagado: ex.d.pago ? ex.d.pago.monto : null })(extractoDeHoy()),
        termina_de_pagar: vivas.length ? vivas.map(({ p }) => p.plan[p.plan.length - 1].mes).sort().pop() : null,
        proximos_extractos: Array.from({ length: 6 }, (_, k) => {
          const m = mesMas(mesDe(hoy()), k), d = tarjetaDelMes(m);
          return { mes: m, total: d.total, capital: d.capital, intereses: d.interes, manejo: d.manejo,
                   comisiones: d.comisiones, pagado: !!d.pago };
        })
      };
    }
    case "simular_compra_tarjeta": {
      if (!estado.tarjeta) return { error: "No hay tarjeta configurada" };
      const plan = planCompra({ id: "simulada", fecha: hoy(), tipo: a.tipo, monto: a.monto,
        cuotas: Math.max(1, a.cuotas), tasaEA: estado.tarjeta.tasaEA,
        comision: a.tipo === "avance" ? estado.tarjeta.comisionAvance : 0, liquidada: null });
      cachePlanes.delete("simulada");
      const costo = plan.reduce((s, q) => s + q.interes + q.comision, 0);
      return { cuotas: plan.map(q => ({ mes: q.mes, capital: q.capital, interes: q.interes, comision: q.comision,
                                          total: q.capital + q.interes + q.comision })),
               intereses_y_comisiones: costo, total_pagado: a.monto + costo };
    }
    case "prestamos":
      return estado.prestamos.map(p => {
        const e = estadoPrestamo(p);
        return { persona: p.persona, concepto: p.concepto, fecha: p.fecha, monto: p.monto,
                 devuelto: devueltoHasta(p), pendiente: e.pendiente, estado: e.texto,
                 fecha_acordada: p.acordada, abonos: p.abonos.map(x => ({ fecha: x.fecha, monto: x.monto })) };
      });
    case "proyeccion_saldo": {
      const p = proyectarSaldo(Math.min(12, Math.max(1, a.meses || 6)));
      const c = resumenMes(mesDe(hoy()));
      return { saldo_hoy_en_la_cuenta: p.base,
               este_mes_falta_recibir_de_sueldo: c.porRecibir, este_mes_falta_pagar: c.pendiente,
               gasto_suelto_promedio: p.variable, meses: p.meses,
               supuestos: "saldo_hoy_en_la_cuenta es plata ya en la cuenta: no incluye el sueldo que falta recibir ni lo que falta pagar este mes. "
                 + "Por eso el primer mes proyectado suma (este_mes_falta_recibir_de_sueldo − este_mes_falta_pagar), que aparece como 'arrastre'. "
                 + "Luego cada mes suma su sueldo previsto y resta fijos, extracto de la tarjeta y gasto suelto promedio. No cuenta ahorros ni préstamos por cobrar." };
    }
    case "historia":
      return mesesRegistrados().map(m => {
        const r = resumenMes(m);
        return { mes: m, inicial: r.inicial, entradas: r.entradas, salidas: r.salidas, cierre: r.saldo,
                 consumo: consumoPorCategoria(m).pares.reduce((s, [, v]) => s + v, 0) };
      });
    case "fijos_y_sueldo": {
      const m = mesDe_(a.mes);
      return {
        mes: m,
        fijos: fijosDe(m).map(f => ({ concepto: f.concepto, categoria: f.categoria, monto: montoVigente(f, m),
                                       pagado_el: f.pagado[m] || null, vigente: enVigencia(f, m) })),
        sueldos: sueldosDe(m).map(s => ({ concepto: s.concepto, frecuencia: s.frecuencia, por_pago: montoVigente(s, m),
                                           esperado: esperadoDe(s, m), recibido: recibidoDe(s, m) }))
      };
    }
  }
  return { error: "herramienta desconocida" };
}

/* ========================================================== conversación */
function instruccionesChat() {
  return `Eres el asistente de una libreta personal de gastos en Colombia. Hoy es ${hoyLargo()}; en la app se está viendo ${nombreMes(mes)}.
Respondes en español de Colombia, tratando de "usted", breve y claro.
Para explicar el uso de la aplicación o sus campos, usa el contexto de la sección y no consultes registros financieros, salvo que la persona pida datos de su libreta.
Antes de dar cualquier cifra, consúltala con las herramientas: nunca inventes ni supongas montos.
Montos en pesos con punto de miles ($1.234.567). Usa listas cortas y **negritas** para lo importante; sin tablas.
Si la pregunta implica decidir (comprar, diferir, abonar), muestra el cálculo con las herramientas y las consecuencias en el saldo, y deja la decisión a la persona.
Si pide registrar movimientos, propóngalos con la herramienta y explique que debe revisarlos y confirmarlos; nunca diga que ya se registraron. No invente montos.
No das asesoría financiera ni de inversión profesional; das análisis de sus propios números y observaciones prácticas de presupuesto.`
  + (opcionChat("optWeb") ? `
Puedes buscar en internet lo que cambia con el tiempo y no está en la libreta: TRM del dólar, tasas de usura o de la tarjeta, precios, noticias. Cita la fuente con un enlace.
Nunca pongas en una búsqueda datos de la persona (nombres, montos, deudas): busca solo el dato público.` : "")
  + (opcionChat("optCodigo") ? `
Puedes ejecutar Python para cálculos largos (amortizaciones, comparaciones, escenarios) y para gráficos o archivos (CSV). Python no ve la libreta:
consulta primero con las herramientas y escribe en el código los números que necesites. Guarda gráficos como PNG en /mnt/data, con títulos y ejes en español,
pesos con punto de miles y colores sobrios, y no repitas en el texto lo que ya muestra el gráfico.` : "");
}

/* ------------------------------------------- herramientas de OpenAI (web y Python) */
const OPCIONES_CHAT = "opcionesChat";
function opcionChat(id) {
  const caja = $(id);
  return caja ? caja.checked : false;
}

function herramientasChat() {
  const lista = [...HERRAMIENTAS, herramienta("proponer_movimientos", "Propone movimientos solicitados por la persona para que los revise y confirme; no los registra.", esquemaMovimientos().properties)];
  if (opcionChat("optWeb")) lista.push({ type: "web_search" });
  if (opcionChat("optCodigo")) lista.push({ type: "code_interpreter", container: { type: "auto" } });
  return lista;
}

const archivoIA = (c, f) => "/api/ia/archivo?" + new URLSearchParams({ c, f, s: contextoSesion });
const esImagen = n => /\.(png|jpe?g|gif|webp|svg)$/i.test(n || "");

/**
 * Lo que trae una respuesta además del texto: las fuentes de internet, el código que
 * corrió con lo que imprimió, y los archivos que creó (los gráficos se ven en el chat).
 */
function extrasDe(output) {
  const fuentes = new Map(), archivos = new Map(), codigos = [];
  output.forEach(o => {
    if (o.type === "code_interpreter_call") codigos.push(o);
    if (o.type !== "message") return;
    (o.content || []).flatMap(c => c.annotations || []).forEach(a => {
      if (a.type === "url_citation" && a.url) fuentes.set(a.url.replace(/[?&]utm_source=openai$/, ""), a.title || a.url);
      if (a.type === "container_file_citation") archivos.set(a.file_id, { c: a.container_id, f: a.file_id, nombre: a.filename });
    });
  });
  return { fuentes, archivos: [...archivos.values()], codigos };
}

/** Cambia los enlaces "sandbox:/mnt/data/x" del texto por la descarga a través del servidor. */
function enlazarArchivos(texto, archivos) {
  return texto.replace(/\]\(sandbox:\/mnt\/data\/([^)]+)\)/g, (todo, nombre) => {
    const a = archivos.find(x => x.nombre === decodeURIComponent(nombre));
    return a ? "](" + location.origin + archivoIA(a.c, a.f) + ")" : "](#)";
  });
}

function pintarExtras(burbujaIA, { fuentes, archivos, codigos }) {
  // Si guardó el gráfico con nombre, ese es el que se muestra; el que salió de plt.show() es copia.
  const imagenes = archivos.filter(a => esImagen(a.nombre));
  const conNombre = imagenes.filter(a => !/^cfile_/.test(a.nombre));
  (conNombre.length ? conNombre : imagenes).forEach(a => {
    const img = document.createElement("img");
    img.className = "imagen-ia";
    img.alt = a.nombre;
    img.src = archivoIA(a.c, a.f);
    burbujaIA.append(img);
  });
  const enlazados = new Set([...burbujaIA.querySelectorAll("a")].map(x => x.getAttribute("href")));
  const otros = archivos.filter(a => !esImagen(a.nombre) && !enlazados.has(location.origin + archivoIA(a.c, a.f)));
  if (otros.length) {
    const p = document.createElement("p");
    p.className = "archivos-ia";
    otros.forEach(a => {
      const l = document.createElement("a");
      l.href = archivoIA(a.c, a.f);
      l.download = a.nombre;
      l.textContent = "⬇ " + a.nombre;
      p.append(l);
    });
    burbujaIA.append(p);
  }
  if (fuentes.size) {
    const d = document.createElement("div");
    d.className = "fuentes-ia";
    d.textContent = "Fuentes: ";
    [...fuentes].forEach(([url, titulo], i) => {
      const l = document.createElement("a");
      l.href = url; l.target = "_blank"; l.rel = "noopener";
      try { l.textContent = new URL(url).hostname.replace(/^www\./, ""); } catch (e) { l.textContent = titulo; }
      l.title = titulo;
      if (i) d.append(" · ");
      d.append(l);
    });
    burbujaIA.append(d);
  }
  codigos.filter(c => c.code).forEach(c => {
    const d = document.createElement("details");
    d.className = "codigo-ia";
    d.innerHTML = "<summary>Ver el código que corrió</summary><pre></pre>";
    const salida = (c.outputs || []).filter(x => x.type === "logs" && x.logs).map(x => x.logs).join("\n").trim();
    d.querySelector("pre").textContent = c.code.trim() + (salida ? "\n\n# Resultado:\n" + salida : "");
    burbujaIA.append(d);
  });
}

function burbuja(clase, html) {
  $("chatBienvenida").hidden = true;
  const b = document.createElement("div");
  b.className = "burbuja " + clase;
  b.innerHTML = html;
  $("chat").append(b);
  $("chat").scrollTop = $("chat").scrollHeight;
  return b;
}

/** Markdown mínimo y seguro: se escapa todo y luego se reconocen negritas y listas. */
function markdown(texto) {
  // Los bloques de código ``` van aparte, tal cual; el resto se arma por párrafos.
  const partes = String(texto).split(/```[\w-]*\n?([\s\S]*?)```/);
  if (partes.length > 1) return partes.map((p, i) => i % 2
    ? "<pre class='codigo-chat'>" + esc(p.replace(/\n$/, "")) + "</pre>"
    : (p.trim() ? markdown(p.trim()) : "")).join("");
  const bloques = esc(texto).split(/\n{2,}/);
  return bloques.map(b => {
    const lineas = b.split("\n");
    const lista = lineas.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l));
    // Enlaces [texto](https://...): los de internet abren en el navegador; los archivos del asistente se descargan.
    const enlaces = s => s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (t, txt, url) => {
      const propio = url.startsWith(location.origin + "/api/ia/archivo");
      return `<a href="${url}"` + (propio ? " download" : ' target="_blank" rel="noopener"') + `>${txt}</a>`;
    });
    const fmt = s => enlaces(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^\w/])\*(?!\s)(.+?)\*(?=\W|$)/g, "$1<i>$2</i>");
    if (lista) {
      const ordenada = /^\s*\d/.test(lineas[0]);
      return (ordenada ? "<ol>" : "<ul>")
        + lineas.map(l => "<li>" + fmt(l.replace(/^\s*([-*•]|\d+[.)])\s+/, "")) + "</li>").join("")
        + (ordenada ? "</ol>" : "</ul>");
    }
    return "<p>" + lineas.map(fmt).join("<br>") + "</p>";
  }).join("");
}

const NOMBRES_HERRAMIENTAS = {
  proponer_movimientos: "propuestas",
  resumen_mes: "resumen del mes", buscar_movimientos: "movimientos", estado_tarjeta: "tarjeta",
  simular_compra_tarjeta: "simulación", prestamos: "préstamos", proyeccion_saldo: "proyección",
  historia: "historia", fijos_y_sueldo: "fijos y sueldo",
  web_search_call: "internet", code_interpreter_call: "Python"
};

/** Sin estado en OpenAI: cada vuelta reenvía la conversación entera. Si el espacio de
 *  Python de una vuelta anterior ya expiró, se reintenta sin esas llamadas. */
async function consultarChat() {
  const pedir = input => consultarIA({ instructions: instruccionesChat(), input,
                                       tools: herramientasChat(), reasoning: { effort: "medium" } });
  try {
    return await pedir(historialChat);
  } catch (e) {
    if (!/container/i.test(e.message) || !historialChat.some(o => o.type === "code_interpreter_call")) throw e;
    historialChat = historialChat.filter(o => o.type !== "code_interpreter_call");
    return pedir(historialChat);
  }
}

async function preguntar(texto) {
  texto = (texto || "").trim();
  if (!texto || conversando) return;
  conversando = true;
  const inicioTurno = historialChat.length, contextoTurno = contextoAyuda;
  $("btnChat").disabled = true;
  $("chatTexto").value = "";
  burbuja("yo", esc(texto));
  const espera = burbuja("ia", cargando);
  const contenido = contextoAyuda
    ? `Contexto de la sección ${contextoAyuda[1]}: ${contextoAyuda[2]}\n\nPregunta del usuario: ${texto}`
    : texto;
  contextoAyuda = null;
  historialChat.push({ role: "user", content: contenido });
  const usadas = [];
  const salidas = [];   // todo lo que devolvió en las vueltas de esta pregunta
  try {
    for (let vuelta = 0; vuelta < 8; vuelta++) {
      const resp = await consultarChat();
      // Lo que devolvió vuelve completo en la siguiente vuelta. Los ids de mensajes y
      // llamadas propias no se reenvían, porque no quedaron guardados allá; las búsquedas
      // y el código sí lo llevan, porque la API los pide.
      (resp.output || []).forEach(o => {
        salidas.push(o);
        if (o.type === "reasoning" || o.type === "web_search_call" || o.type === "code_interpreter_call") historialChat.push(o);
        else { const { id, status, ...resto } = o; historialChat.push(resto); }
        if (NOMBRES_HERRAMIENTAS[o.type]) usadas.push(NOMBRES_HERRAMIENTAS[o.type]);
      });
      const llamadas = (resp.output || []).filter(o => o.type === "function_call");
      if (!llamadas.length) {
        const extras = extrasDe(salidas);
        espera.innerHTML = markdown(enlazarArchivos(textoDe(resp), extras.archivos) || "No tengo una respuesta para eso.");
        pintarExtras(espera, extras);
        break;
      }
      llamadas.forEach(ll => {
        let salida;
        try { salida = ejecutarHerramienta(ll.name, JSON.parse(ll.arguments || "{}")); }
        catch (e) { salida = { error: e.message }; }
        usadas.push(NOMBRES_HERRAMIENTAS[ll.name] || ll.name);
        historialChat.push({ type: "function_call_output", call_id: ll.call_id, output: JSON.stringify(salida) });
      });
      espera.innerHTML = cargando + " <small>consultando " + esc([...new Set(usadas)].join(", ")) + "</small>";
    }
    if (usadas.length) {
      const c = document.createElement("div");
      c.className = "consultas";
      c.textContent = "Consultó: " + [...new Set(usadas)].join(", ");
      $("chat").append(c);
    }
  } catch (e) {
    espera.className = "burbuja error";
    espera.textContent = "No se pudo responder: " + e.message;
    historialChat.splice(inicioTurno);
    if (!$('chatTexto').value) $('chatTexto').value = texto;
    if (!contextoAyuda) contextoAyuda = contextoTurno;
  } finally {
    conversando = false;
    $("btnChat").disabled = false;
    $("chat").scrollTop = $("chat").scrollHeight;
  }
}

function nuevaConversacion() {
  historialChat = [];
  contextoAyuda = null;
  [...$("chat").children].forEach(n => { if (n.id !== "chatBienvenida") n.remove(); });
  $("chatBienvenida").hidden = false;
}

/* ========================================================= lectura del mes */
const ESQUEMA_ANALISIS = {
  type: "object", additionalProperties: false, required: ["resumen", "hallazgos"],
  properties: {
    resumen: { type: "string", description: "Una o dos frases sobre cómo va el mes" },
    hallazgos: {
      type: "array", description: "Entre 3 y 5",
      items: {
        type: "object", additionalProperties: false, required: ["titulo", "detalle", "tono"],
        properties: {
          titulo: { type: "string", description: "Corto, con la cifra clave" },
          detalle: { type: "string", description: "Una o dos frases concretas, con montos" },
          tono: { type: "string", enum: ["bien", "atencion", "alerta"] }
        }
      }
    }
  }
};

async function analizarMes() {
  const m = mes;
  $("btnAnalizar").disabled = true;
  $("analisisNota").innerHTML = cargando + " Revisando " + esc(nombreMes(m).toLowerCase()) + "...";
  try {
    const previos = mesesRegistrados().filter(x => x < m).slice(-3);
    const datos = {
      mes_analizado: datosMes(m), meses_anteriores: previos.map(datosMes),
      tarjeta: ejecutarHerramienta("estado_tarjeta", {}), prestamos: ejecutarHerramienta("prestamos", {}),
      proyeccion: ejecutarHerramienta("proyeccion_saldo", { meses: 3 }),
      fijos_pendientes: fijosDe(m).filter(f => enVigencia(f, m) && !f.pagado[m]).map(f => ({ concepto: f.concepto, monto: montoVigente(f, m) }))
    };
    const resp = await consultarIA({
      instructions: `Analiza el mes de una libreta personal de gastos en Colombia. Hoy es ${hoyLargo()}.
Compara con los meses anteriores, revisa la tarjeta (intereses, cuotas que vienen), los préstamos vencidos y la proyección.
Da hallazgos concretos con montos en pesos ($1.234.567), en español de Colombia, tratando de "usted".
tono: bien = algo positivo; atencion = vale la pena mirarlo; alerta = riesgo de quedarse corto o costo alto.
Nada genérico: cada hallazgo debe salir de las cifras. No es asesoría financiera profesional.`,
      input: [{ role: "user", content: JSON.stringify(datos) }],
      reasoning: { effort: "medium" },
      text: { format: { type: "json_schema", name: "analisis", strict: true, schema: ESQUEMA_ANALISIS } }
    });
    analisisPorMes[m] = jsonDe(resp);
    $("analisisNota").textContent = "Análisis de " + nombreMes(m).toLowerCase() + " a las "
      + new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }).replace(/\.$/, "") + ".";
  } catch (e) {
    $("analisisNota").textContent = "No se pudo analizar: " + e.message;
  } finally {
    $("btnAnalizar").disabled = false;
    renderAnalisis();
  }
}

function renderAnalisis() {
  const cont = $("analisis");
  if (!cont) return;
  cont.innerHTML = "";
  const a = analisisPorMes[mes];
  $("btnAnalizar").lastChild.textContent = a ? " Volver a analizar" : " Analizar el mes";
  if (!a) return;
  const r = document.createElement("p");
  r.className = "resumen-ia";
  r.textContent = a.resumen;
  cont.append(r);
  a.hallazgos.forEach(h => {
    const d = document.createElement("div");
    d.className = "hallazgo " + h.tono;
    d.innerHTML = "<b></b><p></p>";
    d.querySelector("b").textContent = h.titulo;
    d.querySelector("p").textContent = h.detalle;
    cont.append(d);
  });
}

/* --------------------------------------------------------------- arranque */
function iniciarAsistente() {
  $("btnIaRevisar").onclick = revisarIA;
  $("btnAbrirAjustes").onclick = () => irAVista("ajustes");
  $("formClave").onsubmit = async e => {
    e.preventDefault();
    const campo = $("claveIA"), boton = e.currentTarget.querySelector("button");
    boton.disabled = true;
    $("claveNota").textContent = "Guardando…";
    try {
      const r = await fetch("/api/ia/clave", { method: "PUT", headers: { "Content-Type": "application/json", "X-Libreta-Sesion": contextoSesion }, body: JSON.stringify({ clave: campo.value }) });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(datos.error || "Error " + r.status);
      campo.value = "";
      await revisarIA();
      $("claveNota").textContent = "Clave guardada en este equipo.";
    } catch (error) {
      $("claveNota").textContent = "No se pudo guardar la clave: " + error.message;
    } finally { boton.disabled = false; }
  };
  $("btnIaInterpretar").onclick = interpretarTexto;
  $("iaTexto").addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) interpretarTexto();
  });
  $("iaArchivo").onchange = e => { leerArchivo(e.target.files[0]); e.target.value = ""; };
  $("btnChat").onclick = () => preguntar($("chatTexto").value);
  $("chatTexto").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); preguntar($("chatTexto").value); }
  });
  $("chatTexto").addEventListener("input", e => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  });
  $("sugerencias").onclick = e => { const b = e.target.closest("button"); if (b) preguntar(b.textContent); };
  $("btnChatNuevo").onclick = nuevaConversacion;
  // Las casillas de internet y Python se recuerdan en este equipo.
  try {
    const guardadas = JSON.parse(localStorage.getItem(OPCIONES_CHAT) || "{}");
    ["optWeb", "optCodigo"].forEach(id => { if (typeof guardadas[id] === "boolean") $(id).checked = guardadas[id]; });
  } catch (e) { /* sin almacenamiento quedan marcadas */ }
  ["optWeb", "optCodigo"].forEach(id => $(id).addEventListener("change", () => {
    try { localStorage.setItem(OPCIONES_CHAT, JSON.stringify({ optWeb: $("optWeb").checked, optCodigo: $("optCodigo").checked })); }
    catch (e) { /* idem */ }
  }));
  $("btnAnalizar").onclick = analizarMes;
  $("btnIrAnotarIA").onclick = () => { irAVista("asistente"); $("iaTexto").focus(); };
  revisarIA();
}
