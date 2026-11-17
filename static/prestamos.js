"use strict";

/*
 * Plata prestada: a quién se le dio, cuánto y cuánto ha devuelto. Prestar saca la
 * plata del saldo el día que se entrega y cada abono la devuelve como entrada, así
 * que la cuenta del mes cuadra con el banco y aparte queda el rastro por persona.
 */

let abonando = null;          // id del préstamo al que se le está registrando un abono
let verHistorial = new Set(); // préstamos con el historial de abonos desplegado
let verCerrados = false;

function normalizarPrestamo(p) {
  return {
    id: p.id || uid(), persona: (p.persona || "").trim() || "Sin nombre",
    concepto: p.concepto || "", monto: Number(p.monto) || 0,
    fecha: p.fecha || hoy(), acordada: p.acordada || null,
    perdonado: p.perdonado || null,
    abonos: (p.abonos || []).map(a => ({
      id: a.id || uid(), fecha: a.fecha || hoy(), monto: Number(a.monto) || 0, nota: a.nota || ""
    }))
  };
}

const devueltoHasta = (p, fin) => p.abonos.filter(a => !fin || a.fecha <= fin).reduce((s, a) => s + a.monto, 0);

/** Lo que le deben al cerrar el mes m, contando solo lo prestado hasta entonces. */
function teDebenHasta(m) {
  const fin = m + "-32";
  return estado.prestamos.reduce((s, p) => {
    if (p.fecha > fin || (p.perdonado && p.perdonado <= fin)) return s;
    return s + Math.max(p.monto - devueltoHasta(p, fin), 0);
  }, 0);
}

const diasEntre = (a, b) => Math.round((new Date(a + "T12:00") - new Date(b + "T12:00")) / 864e5);

function estadoPrestamo(p) {
  const pendiente = Math.max(p.monto - devueltoHasta(p), 0);
  if (p.perdonado) return { clave: "perdonado", texto: "Perdonado", pendiente: 0, perdido: pendiente };
  if (!pendiente) return { clave: "pagado", texto: "Pagado", pendiente: 0 };
  if (!p.acordada) return { clave: "activo", texto: "Sin fecha", pendiente };
  const dias = diasEntre(p.acordada, hoy());
  if (dias < 0) return { clave: "vencido", texto: "Vencido hace " + -dias + (dias === -1 ? " día" : " días"), pendiente };
  if (dias === 0) return { clave: "pronto", texto: "Vence hoy", pendiente };
  if (dias <= 7) return { clave: "pronto", texto: "Vence en " + dias + (dias === 1 ? " día" : " días"), pendiente };
  return { clave: "activo", texto: "Paga el " + diaCorto(p.acordada), pendiente };
}

function renderPrestamos() {
  const cont = $("listaPrestamos");
  cont.innerHTML = "";
  const conEstado = estado.prestamos.map(p => ({ p, e: estadoPrestamo(p) }));
  const abiertos = conEstado.filter(x => x.e.pendiente > 0);
  const cerrados = conEstado.filter(x => !x.e.pendiente);

  if (!abiertos.length) {
    cont.innerHTML = '<div class="vacio">Nadie le debe plata. Cuando preste algo, anótelo abajo y aquí queda el rastro.</div>';
  }

  // Agrupado por persona: lo que importa es cuánto le debe cada quien.
  const porPersona = new Map();
  abiertos.forEach(x => {
    if (!porPersona.has(x.p.persona)) porPersona.set(x.p.persona, []);
    porPersona.get(x.p.persona).push(x);
  });
  [...porPersona.entries()]
    .sort((a, b) => b[1].reduce((s, x) => s + x.e.pendiente, 0) - a[1].reduce((s, x) => s + x.e.pendiente, 0))
    .forEach(([persona, lista]) => cont.append(cajaPersona(persona, lista)));

  const total = abiertos.reduce((s, x) => s + x.e.pendiente, 0);
  $("prestamosResumen").textContent = total ? "le deben " + cop(total) : "";

  const caja = $("prestamosCerradosCaja");
  caja.innerHTML = "";
  if (cerrados.length) {
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = (verCerrados ? "Ocultar" : "Ver") + " " + cerrados.length + " préstamo(s) saldados";
    btn.onclick = () => { verCerrados = !verCerrados; render(); };
    caja.append(btn);
    if (verCerrados) {
      cerrados.sort((a, b) => b.p.fecha.localeCompare(a.p.fecha))
        .forEach(x => caja.append(filaPrestamo(x.p, x.e, true)));
    }
  }

  const lista = $("personas");
  lista.innerHTML = "";
  [...new Set(estado.prestamos.map(p => p.persona))].sort().forEach(n => {
    const o = document.createElement("option");
    o.value = n;
    lista.append(o);
  });
}

function cajaPersona(persona, lista) {
  const caja = document.createElement("div");
  caja.className = "persona";
  const debe = lista.reduce((s, x) => s + x.e.pendiente, 0);
  const cab = document.createElement("div");
  cab.className = "persona-cab";
  cab.innerHTML = "<b></b><span></span>";
  cab.querySelector("b").textContent = persona;
  cab.querySelector("b").dataset.inicial = persona.charAt(0).toUpperCase();
  cab.querySelector("span").textContent = "debe " + cop(debe);
  caja.append(cab);
  lista.sort((a, b) => a.p.fecha.localeCompare(b.p.fecha)).forEach(x => caja.append(filaPrestamo(x.p, x.e)));
  return caja;
}

function filaPrestamo(p, e, cerrado) {
  const bloque = document.createElement("div");
  bloque.className = "prestamo";

  const fila = document.createElement("div");
  fila.className = "fila" + (cerrado ? " tenue" : "");

  const marca = document.createElement("span");
  marca.className = "badge " + e.clave;
  marca.textContent = e.texto;

  const devuelto = devueltoHasta(p);
  const detalle = [(cerrado ? p.persona + " · " : "") + "prestó " + cop(p.monto) + " el " + diaCorto(p.fecha)];
  if (devuelto) detalle.push("devolvió " + cop(devuelto));
  if (e.perdido) detalle.push("se perdieron " + cop(e.perdido));

  fila.append(marca, textoFila(p.concepto || "Préstamo", detalle.join(" · ")),
              valorFila(cerrado ? cop(p.monto) : cop(e.pendiente), cerrado ? "" : "entrada"));

  if (!cerrado) {
    const abonar = document.createElement("button");
    abonar.className = abonando === p.id ? "" : "primario";
    abonar.textContent = abonando === p.id ? "Cancelar" : "Abonó";
    abonar.onclick = () => { abonando = abonando === p.id ? null : p.id; render(); };
    fila.append(abonar);

    const recordar = document.createElement("button");
    recordar.className = "ghost";
    recordar.textContent = "Recordar";
    recordar.title = "Copia un mensaje para enviarle";
    recordar.onclick = async () => {
      const texto = `Hola ${p.persona}, te escribo por la plata que te presté el ${diaCorto(p.fecha)}`
        + (p.concepto ? ` (${p.concepto})` : "") + `. Quedan pendientes ${cop(e.pendiente)}`
        + (p.acordada ? `, habíamos quedado para el ${diaCorto(p.acordada)}` : "") + ". ¡Gracias!";
      try {
        await navigator.clipboard.writeText(texto);
        recordar.textContent = "Copiado";
        setTimeout(() => { recordar.textContent = "Recordar"; }, 1600);
      } catch (err) { prompt("Copie el mensaje:", texto); }
    };
    fila.append(recordar);
  }

  const mas = document.createElement("button");
  mas.className = "ghost";
  mas.textContent = verHistorial.has(p.id) ? "Menos" : "Más";
  mas.onclick = () => {
    if (verHistorial.has(p.id)) verHistorial.delete(p.id); else verHistorial.add(p.id);
    render();
  };
  fila.append(mas);
  bloque.append(fila);

  if (abonando === p.id) bloque.append(formularioAbono(p, e));
  if (verHistorial.has(p.id)) bloque.append(historialPrestamo(p, e));
  return bloque;
}

function formularioAbono(p, e) {
  const caja = document.createElement("div");
  caja.className = "retiro";
  caja.innerHTML = `
    <div><label>Cuánto devolvió</label><input class="rMonto" type="number" min="0" step="1000"></div>
    <div><label>Nota</label><input class="rDesc" placeholder="Por Nequi"></div>
    <div><label>Fecha</label><input class="rFecha" type="date"></div>
    <button class="primario rOk">Registrar</button>
    <small></small>`;
  const monto = caja.querySelector(".rMonto");
  const desc = caja.querySelector(".rDesc");
  const fecha = caja.querySelector(".rFecha");
  monto.value = e.pendiente;
  fecha.value = diaDentroDe(mes);
  caja.querySelector("small").textContent = "Debe " + cop(e.pendiente) + ". Si devolvió solo una parte, escriba lo que entró.";
  const confirmar = () => {
    const valor = Number(monto.value);
    if (!valor || valor <= 0) { monto.focus(); return; }
    p.abonos.push({ id: uid(), fecha: fecha.value || diaDentroDe(mes), monto: valor, nota: desc.value.trim() });
    abonando = null;
    render(); guardar();
  };
  caja.querySelector(".rOk").onclick = confirmar;
  [monto, desc].forEach(x => x.addEventListener("keydown", ev => { if (ev.key === "Enter") confirmar(); }));
  return caja;
}

function historialPrestamo(p, e) {
  const caja = document.createElement("div");
  caja.className = "historial";

  const linea = (fecha, texto, valor, clase, quitar) => {
    const fila = document.createElement("div");
    fila.className = "cuota" + (clase ? " " + clase : "");
    fila.append(textoFila(texto, diaCorto(fecha)), valorFila(valor));
    if (quitar) {
      const b = document.createElement("button");
      b.className = "ghost";
      b.textContent = "Quitar";
      b.onclick = quitar;
      fila.append(b);
    }
    caja.append(fila);
  };

  linea(p.fecha, "Le prestó" + (p.concepto ? " · " + p.concepto : ""), "−" + cop(p.monto));
  p.abonos.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(a =>
    linea(a.fecha, "Devolvió" + (a.nota ? " · " + a.nota : ""), "+" + cop(a.monto), "lista", () => {
      p.abonos = p.abonos.filter(x => x.id !== a.id);
      render(); guardar();
    }));
  if (p.perdonado) linea(p.perdonado, "Lo dio por perdido", cop(e.perdido || 0));

  const botones = document.createElement("div");
  botones.className = "edicion-botones";
  const acordada = document.createElement("input");
  acordada.type = "date";
  acordada.value = p.acordada || "";
  acordada.title = "Fecha en que quedó de pagar";
  acordada.style.width = "auto";
  acordada.onchange = () => { p.acordada = acordada.value || null; render(); guardar(); };
  const etiqueta = document.createElement("small");
  etiqueta.textContent = "Quedó de pagar:";
  botones.append(etiqueta, acordada);

  const sep = document.createElement("span");
  sep.className = "separador";
  botones.append(sep);

  if (!p.perdonado && e.pendiente) {
    const perdonar = document.createElement("button");
    perdonar.className = "ghost";
    perdonar.textContent = "Dar por perdido";
    perdonar.onclick = () => {
      if (!confirm(`¿Dar por perdidos los ${cop(e.pendiente)} que debe ${p.persona}? Lo ya devuelto se conserva.`)) return;
      p.perdonado = hoy();
      render(); guardar();
    };
    botones.append(perdonar);
  } else if (p.perdonado) {
    const revivir = document.createElement("button");
    revivir.className = "ghost";
    revivir.textContent = "Volver a cobrar";
    revivir.onclick = () => { p.perdonado = null; render(); guardar(); };
    botones.append(revivir);
  }

  const borrar = document.createElement("button");
  borrar.className = "ghost peligro";
  borrar.textContent = "Borrar";
  borrar.onclick = () => {
    if (!confirm(`¿Borrar el préstamo a ${p.persona} con sus ${p.abonos.length} abono(s)? El saldo de esos meses cambiará.`)) return;
    estado.prestamos = estado.prestamos.filter(x => x.id !== p.id);
    render(); guardar();
  };
  botones.append(borrar);
  caja.append(botones);
  return caja;
}

function agregarPrestamo() {
  const persona = $("pPersona").value.trim();
  const monto = Number($("pMonto").value);
  if (!persona) { $("pPersona").focus(); return; }
  if (!monto || monto <= 0) { $("pMonto").focus(); return; }
  const fecha = $("pFecha").value || diaDentroDe(mes);
  estado.prestamos.push(normalizarPrestamo({
    persona, monto, fecha, concepto: $("pConcepto").value.trim(), acordada: $("pAcordada").value || null
  }));
  if (mesDe(fecha) !== mes) mes = mesDe(fecha);
  ["pPersona", "pConcepto", "pMonto", "pAcordada"].forEach(id => { $(id).value = ""; });
  render(); guardar();
}

function iniciarPrestamos() {
  $("pFecha").value = hoy();
  $("btnPrestamo").onclick = agregarPrestamo;
  ["pPersona", "pConcepto", "pMonto"].forEach(id =>
    $(id).addEventListener("keydown", e => { if (e.key === "Enter") agregarPrestamo(); }));
}
