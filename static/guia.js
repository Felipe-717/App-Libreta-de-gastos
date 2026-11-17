"use strict";

const PASOS_GUIA = [
  ["resumen", "Resumen", "Consulte el saldo disponible y los próximos pagos. En Nuevo movimiento escriba qué fue (por ejemplo, almuerzo), el monto y la fecha."],
  ["movimientos", "Movimientos", "Tipo indica qué pasó: gasto o ingreso, por ejemplo. Categoría agrupa el motivo: un almuerzo puede ser Alimentación. Escriba concepto, monto y fecha; busque o filtre el historial."],
  ["fijos", "Fijos y sueldo", "En Nuevo fijo escriba concepto (por ejemplo, arriendo), categoría, monto y repetición. En Sueldo esperado indique el monto por pago y frecuencia. Saldo inicial es el dinero que tenía al comenzar el mes, no su sueldo esperado."],
  ["tarjeta", "Tarjeta", "Cupo es el límite de crédito; tasa E.A. es la tasa efectiva anual informada por el banco, en porcentaje. Corte y pago son días del mes. En una compra, cuotas es el número de pagos; cuota de manejo es el cargo periódico del banco."],
  ["prestamos", "Préstamos", "Escriba a quién prestó, el monto y la fecha de entrega. Quedó de pagar es la fecha acordada de devolución; luego registre cada abono recibido."],
  ["ahorros", "Ahorros", "Nombre identifica el bolsillo (por ejemplo, emergencia). Meta mensual es lo que quiere apartar cada mes; ahorro inicial es lo ya acumulado y meta total es el objetivo opcional. Registre aportes y retiros en Movimientos."],
  ["historia", "Historia", "Compare el cierre de cada mes, sus ahorros y patrimonio. El patrimonio suma saldo, ahorros y lo que le deben, y resta la deuda de la tarjeta."],
  ["asistente", "Asistente", "Si configura una clave, podrá hacer preguntas y revisar propuestas antes de registrar movimientos. Al usarlo se envían los datos necesarios a OpenAI."],
  ["ajustes", "Configuración", "Configure la clave del asistente. La clave se guarda en este equipo."]
];


const RECORRIDO_GUIA = [
  ["resumen", "Saldo disponible", "Vea aquí cuánto queda disponible después de los pagos pendientes del mes.", ".portada-cifra"],
  ["resumen", "Por pagar", "Consulte los próximos pagos pendientes o abra la agenda para ver más detalles.", "#portadaPagos"],
  ["movimientos", "Tipo de movimiento", "Elija qué pasó: por ejemplo, una salida por gasto o una entrada por ingreso.", "#gTipo"],
  ["movimientos", "Categoría", "Agrupe el motivo del movimiento: por ejemplo, un almuerzo puede ser Alimentación. Complete concepto, monto y fecha antes de anotar.", "#gCat"],
  ["fijos", "Gastos fijos", "Escriba un concepto, como arriendo, y seleccione categoría, monto y repetición.", "#fConcepto"],
  ["fijos", "Saldo inicial", "Indique el dinero que tenía al comenzar el mes, no el sueldo esperado. También puede usar el cierre del mes anterior.", "#inpInicial"],
  ["tarjeta", "Tarjeta", "Configure cupo, tasa E.A. y fechas según su banco. La tasa E.A. es el porcentaje efectivo anual; las cuotas indican en cuántos pagos se difiere una compra.", "#panelTarjeta > h2"],
  ["prestamos", "Préstamos", "Escriba a quién prestó, el monto y la fecha de entrega.", "#pPersona"],
  ["prestamos", "Fecha acordada", "Indique cuándo espera la devolución; después puede registrar cada abono recibido.", "#pAcordada"],
  ["ahorros", "Metas de ahorro", "Nombre el bolsillo, por ejemplo emergencia.", "#aNombre"],
  ["ahorros", "Meta mensual", "Indique lo que quiere apartar cada mes; la meta total es opcional.", "#aMonto"],
  ["historia", "Historia", "Compare el cierre y el patrimonio de cada mes. El patrimonio suma saldo, ahorros y lo que le deben, y resta la deuda de la tarjeta.", "#tablaHist thead"],
  ["asistente", "Asistente", "Con una clave puede hacer preguntas y revisar propuestas. Al usarlo, los datos necesarios se envían a OpenAI.", "[data-en='asistente'].vista-cabecera h1"],
  ["ajustes", "Configuración", "Configure aquí la clave del asistente. Se guarda en este equipo.", "#formClave"]
];

let mostrarGuiaVista = () => {};

function iniciarGuia() {
  const app = document.querySelector(".app");
  const dialogo = document.createElement("dialog");
  dialogo.className = "guia-recorrido";
  dialogo.setAttribute("aria-labelledby", "guiaTitulo");
  dialogo.setAttribute("aria-describedby", "guiaDetalle");
  dialogo.innerHTML = '<div class="guia-foco" aria-hidden="true"></div><div class="guia-tarjeta"><p class="guia-progreso" aria-live="polite"></p><h2 id="guiaTitulo" aria-live="polite"></h2><p id="guiaDetalle" class="guia-texto"></p><div class="guia-acciones"><button type="button" class="guia-salir">Cerrar guía</button><button type="button" class="guia-anterior">Anterior</button><button type="button" class="primario guia-siguiente">Siguiente</button></div></div>';
  app.append(dialogo);
  const foco = dialogo.querySelector(".guia-foco");
  const tarjeta = dialogo.querySelector(".guia-tarjeta");
  const intro = document.createElement("dialog");
  intro.className = "guia-intro";
  intro.setAttribute("aria-labelledby", "guiaIntroTitulo");
  intro.setAttribute("aria-describedby", "guiaIntroDetalle");
  intro.innerHTML = '<div class="guia-intro-visual" aria-hidden="true"></div><h2 id="guiaIntroTitulo"></h2><p id="guiaIntroDetalle" class="guia-texto"></p><div class="guia-acciones"><button type="button" class="guia-intro-salir">Omitir</button><button type="button" class="primario guia-intro-siguiente">Siguiente</button></div>';
  app.append(intro);
  let paso = 0, pasos = [], objetivo = null;
  const colocar = () => {
    if (!dialogo.open || !objetivo) return;
    const r = objetivo.getBoundingClientRect(), margen = 8;
    const visible = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    if (visible) {
      Object.assign(foco.style, { left: Math.max(0, r.left - 4) + "px", top: Math.max(0, r.top - 4) + "px",
        width: Math.min(innerWidth, r.right + 4) - Math.max(0, r.left - 4) + "px",
        height: Math.min(innerHeight, r.bottom + 4) - Math.max(0, r.top - 4) + "px" });
    } else Object.assign(foco.style, { left: "0px", top: "0px", width: "0px", height: "0px" });
    const ancho = tarjeta.offsetWidth, alto = tarjeta.offsetHeight;
    const abajo = r.bottom + 16, arriba = r.top - alto - 16;
    let top = abajo + alto <= innerHeight - margen ? abajo : arriba >= margen ? arriba : innerHeight - alto - margen;
    let left = Math.max(margen, Math.min(r.left, innerWidth - ancho - margen));
    if (abajo + alto > innerHeight - margen && arriba < margen) {
      if (r.right + 16 + ancho <= innerWidth - margen) left = r.right + 16;
      else if (r.left - 16 - ancho >= margen) left = r.left - 16 - ancho;
      top = Math.min(Math.max(margen, r.top), innerHeight - alto - margen);
    }
    Object.assign(tarjeta.style, { left: left + "px", top: Math.max(margen, Math.min(top, innerHeight - alto - margen)) + "px" });
  };
  const centrarObjetivo = () => {
    if (objetivo) objetivo.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    colocar();
  };
  const pintar = () => {
    const [vista, titulo, detalle, selector] = pasos[paso];
    objetivo = document.querySelector(selector);
    if (vista === "tarjeta") {
      objetivo = [document.querySelector("#tCupo"), document.querySelector("#tarjetaCabecera button"), objetivo]
        .find(elemento => elemento && elemento.getClientRects().length);
    }
    if (objetivo && objetivo.id && objetivo.parentElement && objetivo.parentElement.children.length <= 3 &&
        [...objetivo.parentElement.children].some(elemento => elemento.tagName === "LABEL" && elemento.htmlFor === objetivo.id)) {
      objetivo = objetivo.parentElement;
    }
    dialogo.querySelector(".guia-progreso").textContent = `Guía · ${paso + 1} de ${pasos.length}`;
    dialogo.querySelector("#guiaTitulo").textContent = titulo;
    dialogo.querySelector(".guia-texto").textContent = detalle;
    dialogo.querySelector(".guia-anterior").disabled = paso === 0;
    dialogo.querySelector(".guia-siguiente").textContent = paso === pasos.length - 1 ? "Terminar" : "Siguiente";
    centrarObjetivo();
  };
  const abrir = vista => {
    const actual = PASOS_GUIA.find(p => p[0] === vista);
    if (!actual || intro.open || dialogo.open) return;
    pasos = RECORRIDO_GUIA.filter(p => p[0] === vista);
    paso = 0;
    intro.querySelector(".guia-intro-visual").dataset.guiaVisual = vista;
    intro.querySelector("#guiaIntroTitulo").textContent = actual[1];
    intro.querySelector("#guiaIntroDetalle").textContent = actual[2];
    if (!estado.guiaVistas[vista]) {
      estado.guiaVistas[vista] = true;
      guardar();
    }
    intro.showModal();
    intro.querySelector(".guia-intro-siguiente").focus();
  };
  intro.querySelector(".guia-intro-salir").onclick = () => intro.close();
  intro.querySelector(".guia-intro-siguiente").onclick = () => {
    intro.close();
    delete dialogo.dataset.movimiento;
    dialogo.showModal();
    pintar();
    // Fija la posición inicial antes de animar los cambios de paso.
    tarjeta.getBoundingClientRect();
    dialogo.dataset.movimiento = "";
    dialogo.querySelector(".guia-siguiente").focus();
  };
  dialogo.querySelector(".guia-salir").onclick = () => dialogo.close();
  dialogo.querySelector(".guia-anterior").onclick = () => {
    paso--; pintar();
    if (!paso) dialogo.querySelector(".guia-siguiente").focus();
  };
  dialogo.querySelector(".guia-siguiente").onclick = () => {
    if (paso === pasos.length - 1) dialogo.close();
    else { paso++; pintar(); }
  };
  window.addEventListener("resize", () => { if (dialogo.open) centrarObjetivo(); });
  window.addEventListener("scroll", colocar, true);
  mostrarGuiaVista = vista => { if (!estado.guiaVistas[vista]) abrir(vista); };
  $("btnGuia").onclick = () => abrir(document.body.dataset.vista || "resumen");

  const ayuda = document.createElement("dialog");
  ayuda.className = "guia-dialogo";
  ayuda.setAttribute("aria-labelledby", "ayudaTitulo");
  ayuda.innerHTML = '<h2 id="ayudaTitulo"></h2><p class="guia-texto"></p><p class="guia-aviso"></p><div class="guia-acciones"><button type="button" class="ayuda-cerrar">Cerrar</button><button type="button" class="primario ayuda-preguntar">Preguntar al asistente</button></div>';
  app.append(ayuda);
  let actual;
  ayuda.querySelector(".ayuda-cerrar").onclick = () => ayuda.close();
  ayuda.querySelector(".ayuda-preguntar").onclick = () => {
    const entrada = $("chatTexto");
    contextoAyuda = actual;
    if (!entrada.value.trim()) entrada.value = "Ayúdeme con esta sección.";
    ayuda.close();
    irAVista("asistente");
    if (!intro.open) {
      if (ia.configurada) entrada.focus();
      else $("btnAbrirAjustes").focus();
    }
  };

  const flotante = document.createElement("button");
  flotante.type = "button";
  flotante.className = "guia-asistente";
  flotante.setAttribute("aria-label", "Ayuda sobre esta sección");
  flotante.title = "Ayuda sobre esta sección";
  flotante.innerHTML = '<span class="guia-avatar"><img src="avatar-asistente.png" alt=""><span class="guia-luces" aria-hidden="true"></span></span><span>Ayuda</span>';
  flotante.onclick = () => {
    actual = PASOS_GUIA.find(p => p[0] === document.body.dataset.vista) || PASOS_GUIA[0];
    ayuda.querySelector("#ayudaTitulo").textContent = "Ayuda · " + actual[1];
    ayuda.querySelector(".guia-texto").textContent = actual[2];
    ayuda.querySelector(".guia-aviso").textContent = ia.configurada
      ? "Se preparará una pregunta editable si no tiene un borrador; ningún mensaje se envía automáticamente."
      : "Para consultar al asistente, primero configure una clave. Al usarlo, los datos necesarios se envían a OpenAI.";
    ayuda.showModal();
  };
  app.append(flotante);
  mostrarGuiaVista(document.body.dataset.vista || "resumen");
}
