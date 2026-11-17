"use strict";

/*
 * Separador de miles mientras se escribe: 3300000 se ve 3.300.000. Los campos de
 * dinero pasan de type=number a texto, pero su .value sigue devolviendo solo los
 * dígitos ("3300000"), así que todo el código que hace Number(campo.value) no
 * cambia. Lo que no es plata (cuotas, días, tasa) lleva step="1" o step="0.01" y
 * se deja tal cual.
 */

(() => {
  const nativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const limpio = t => {
    const s = String(t ?? "").trim();
    const signo = s.startsWith("-") ? "-" : "";
    const digitos = s.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    return digitos ? signo + digitos : signo;
  };
  const conPuntos = t => {
    const s = limpio(t);
    const signo = s.startsWith("-") ? "-" : "";
    const d = s.replace("-", "");
    return signo + d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const esDinero = i => i.type === "number" && !["1", "0.01"].includes(i.getAttribute("step"))
                        && !i.dataset.sinMiles;

  function convertir(i) {
    if (i.dataset.miles) return;
    const valor = i.value;
    i.dataset.miles = "1";
    i.type = "text";
    i.inputMode = "numeric";
    i.autocomplete = "off";
    i.classList.add("monto");
    if (/^-?\d+$/.test(i.placeholder)) i.placeholder = conPuntos(i.placeholder);
    // Lo que lee el código son los dígitos; lo que ve la persona, con puntos.
    Object.defineProperty(i, "value", {
      configurable: true,
      get() { const v = limpio(nativo.get.call(this)); return v === "-" ? "" : v; },
      set(v) { nativo.set.call(this, conPuntos(v)); }
    });
    i.value = valor;

    i.addEventListener("input", e => {
      const crudo = nativo.get.call(i);
      // Se conserva la posición del cursor contando los dígitos que tiene a la izquierda.
      const cursor = i.selectionStart ?? crudo.length;
      const antes = crudo.slice(0, cursor).replace(/[^\d-]/g, "").length;
      const nuevo = conPuntos(crudo);
      if (nuevo === crudo) return;
      nativo.set.call(i, nuevo);
      let pos = 0, vistos = 0;
      while (pos < nuevo.length && vistos < antes) { if (/[\d-]/.test(nuevo[pos])) vistos++; pos++; }
      i.setSelectionRange(pos, pos);
    }, true);   // en captura: el formato queda listo antes que los demás oyentes lean el valor

    i.addEventListener("keydown", e => {
      // Flechas arriba y abajo suben o bajan de a 1.000, como hacía el campo numérico.
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const paso = Number(i.getAttribute("step")) || 1000;
      i.value = Math.max(i.getAttribute("min") === "0" ? 0 : -Infinity, (Number(i.value) || 0) + (e.key === "ArrowUp" ? paso : -paso));
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const revisar = raiz => {
    if (raiz.nodeType !== 1) return;
    if (raiz.matches && raiz.matches("input") && esDinero(raiz)) convertir(raiz);
    raiz.querySelectorAll && raiz.querySelectorAll("input[type=number]").forEach(i => { if (esDinero(i)) convertir(i); });
  };

  revisar(document.body);
  // Los formularios que se arman al vuelo (abonar, editar, pagar, propuestas) también.
  new MutationObserver(cambios => cambios.forEach(c => c.addedNodes.forEach(revisar)))
    .observe(document.body, { childList: true, subtree: true });

  window.conPuntos = conPuntos;
})();
