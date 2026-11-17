# Libreta de gastos

Aplicación local para llevar el control de gastos mensuales. La interfaz corre en el
navegador y cada perfil guarda sus datos en una base SQLite en el equipo.

Qué lleva la cuenta:

- Saldo encadenado: el cierre de un mes es el saldo inicial del siguiente, y se puede
  sobrescribir a mano cuando el banco dice otra cosa.
- Ingresos con su propio panel y origen (sueldo, regalo, reembolso, venta...).
- Sueldo previsto, mensual o por quincena, que no entra al saldo hasta registrarlo.
- Gastos fijos editables, con cambios de monto que rigen desde un mes en adelante, y que
  pueden ser de todos los meses o de uno solo, como una deuda puntual.
- Ahorros con nombre, meta mensual, saldo inicial y meta total; el acumulado se
  conserva y abonar es voluntario.
- Movimientos del mes marcados como entrada o salida, incluyendo los pagos de fijos.
- Gastos, ingresos, aportes y retiros se pueden editar (tipo, concepto, categoría o
  bolsillo, monto y fecha) desde Movimientos o desde Ingresos del mes.
- Tabla de historia mes a mes.
- Tarjeta de crédito: compras a cuotas con su interés, cuota de manejo, avances, pago
  mensual del extracto y proyección de los próximos seis meses.
- Plata prestada: a quién, cuánto, cuándo quedó de pagar y cada abono que devuelve.
- Lo que viene: pagos y cobros pendientes del mes y los dos siguientes.
- El mes día a día: el saldo de la cuenta en el tiempo, con lo que ya pasó y lo previsto
  (quincenas por recibir, fijos, pago de la tarjeta, préstamos que vencen), dividido en
  periodos según el sueldo, con lo que entra, sale, queda y el punto más bajo de cada uno.
- El pago de la tarjeta de cada mes no es un fijo: lo calcula la app. Se ve aparte en el
  Resumen, en la barra del mes y arriba de los fijos.
- Resumen con gráficos: saldo mes a mes con proyección a seis meses, consumo por
  categoría, entradas contra salidas y un mapa del gasto por día.
- Menú por secciones (Resumen, Movimientos, Fijos y sueldo, Tarjeta, Préstamos,
  Ahorros, Historia) con avisos de lo atrasado, y modo claro u oscuro.
- Asistente con OpenAI: anotar escribiendo como habla, leer fotos de recibos y
  extractos en PDF, preguntarle a sus cuentas y una lectura del mes con hallazgos.
- Presupuesto por categoría con el ritmo del mes, patrimonio neto mes a mes, un panel
  "Para revisar" con pagos por vencer, topes pasados, alzas y gastos que se repiten,
  notificaciones de Windows y búsqueda en todos los movimientos.

## Cómo se ejecuta

Con el acceso directo "Libreta de gastos" del escritorio. Abre la app en su propia
ventana, sin terminal, y al cerrar la ventana guarda lo pendiente y apaga el servidor.
Si ya está abierta, el acceso directo la trae al frente en vez de abrir otra. La
ventana recuerda la sesión y las preferencias en %LOCALAPPDATA%\LibretaDeGastos.
Para terminar tu sesión, usa **Cerrar sesión** en la app.

El acceso directo usa su propio entorno de Python en .venv. Para crearlo de nuevo, o si
mueve la carpeta de lugar:

    powershell -ExecutionPolicy Bypass -File instalar.ps1

También sigue funcionando sin ventana propia, en el navegador y con terminal:

    python servidor.py

Así no requiere ninguna dependencia externa. El navegador se abre solo en
http://127.0.0.1:8756. Para detenerlo, Ctrl+C en la terminal.

## Estructura

    app.pyw              ventana de escritorio (pywebview) que arranca y apaga el servidor
    instalar.ps1         crea .venv y el acceso directo del escritorio
    requirements.txt     dependencias del entorno .venv
    servidor.py          servidor local y API de lectura y escritura
    auth.py              perfiles, contraseñas y sesiones locales
    almacen.py           almacenamiento SQLite, importación y respaldos
    agente.py            puente con la API de OpenAI; la clave se queda aquí
    credenciales.py      almacenamiento de la clave en Windows
    .env.ejemplo         configuración opcional del asistente para desarrollo
    static/index.html    marcado de la interfaz
    static/styles.css    estilos
    static/app.js        lógica de cálculo y sincronización
    static/tarjeta.js    tarjeta de crédito: compras, cuotas, intereses y extracto
    static/prestamos.js  plata prestada y sus abonos
    static/graficos.js   gráficos del resumen, en SVG y sin librerías
    static/asistente.js  el asistente: propuestas, conversación y lectura del mes
    static/montos.js     separador de miles en los campos de plata (3.300.000)
    static/presupuesto.js topes por categoría y su ritmo
    static/avisos.js     panel Para revisar y notificaciones de Windows
    static/icono.ico     ícono de la app
    datos/gastos.sqlite3 base local que la app crea al arrancar
    datos/gastos.json    libreta anterior, si existe, que se importa al crear el primer perfil
    datos/respaldos/     copias JSON diarias, hasta 30 por perfil

## Mover los datos

Con la app cerrada, copia `datos/` junto al ejecutable de destino. El JSON antiguo queda
como respaldo después de la importación. Las claves de OpenAI están en Windows.

## API

    GET  /api/sesion      devuelve el perfil local activo y su contexto de sesión
    POST /api/registro   crea un perfil local
    POST /api/ingreso    inicia sesión con usuario y contraseña
    POST /api/salir      revoca la sesión activa
    GET  /api/datos      devuelve la libreta del perfil activo como JSON
    PUT  /api/datos      valida la libreta y guarda los cambios en SQLite
    GET  /api/ia/estado   dice si hay clave de OpenAI y qué modelo se usa
    PUT  /api/ia/clave    guarda la clave en el Administrador de credenciales de Windows
    POST /api/ia          reenvía una consulta a la API Responses de OpenAI
    POST /api/notificar   muestra una notificación de Windows (título y texto)

Los archivos de la interfaz se sirven con Cache-Control: no-cache, así que después de
una actualización la ventana carga el código nuevo y no el guardado.

Cada guardado y la importación inicial usan una transacción SQLite.

## Modelo de datos

El archivo [libreta-ficticia.json](demo/libreta-ficticia.json) contiene un ejemplo completo.

El campo tipo acepta gasto, ingreso, aporte y retiro. Los movimientos de tipo aporte y
retiro pueden apuntar a un ahorro con el campo ahorro; los ingresos pueden apuntar a un
sueldo con sueldo y cuota, donde cuota es el índice del pago dentro del mes.

En ahorros, monto es la meta mensual sugerida y objetivo la meta total. En sueldos,
monto es lo que se recibe en cada pago y frecuencia acepta mensual, quincenal o semanal.

Los archivos anteriores se leen sin intervención: los campos nuevos toman su valor por
defecto, un pagado con valor true se interpreta como pagado el día 1, y el antiguo
aportado de los ahorros se convierte en movimientos de tipo aporte.

### Cómo se preserva la historia

- monto es el valor base de un fijo o de un aporte de ahorro; montos guarda los cambios
  con la fecha desde la que rigen. El monto vigente en un mes es el último cambio
  anotado hasta ese mes, así que subir la cuota de la tarjeta no altera los meses ya
  cerrados. Editar con la opción "corregir en toda la historia" limpia montos.
- desde y hasta acotan la vigencia, y el selector Repetición los maneja:
  "sigue todos los meses" deja hasta en null, "termina este mes" pone hasta en el mes
  visible, y "solo este mes" iguala desde y hasta.
- El historial se calcula sobre lo marcado como pagado, no sobre la vigencia, así que
  acotar un fijo nunca altera el saldo de un mes ya cerrado. Borrarlo sí lo altera,
  porque desaparecen también sus pagos: para retirar un gasto sin tocar el pasado hay
  que terminarlo, no borrarlo.
- pagado y aportado guardan la fecha del pago de cada mes, que es lo que alimenta la
  lista de movimientos.

## Tarjeta de crédito

Comprar con la tarjeta no saca plata de la cuenta; la saca el pago del extracto. Por eso
las compras viven en compras y no en movimientos, y lo que toca el saldo es el pago
registrado de cada mes en tarjeta.pagos.

- Cada compra cae en el extracto según el día de corte, y se paga en el mes del día
  límite de pago que sigue a ese corte.
- Las cuotas se liquidan como Bancolombia: abono a capital fijo (monto / cuotas) más
  el interés del mes sobre el saldo que queda. La tasa mensual sale de la E.A.:
  (1 + E.A.)^(1/12) - 1.
- A una cuota la compra no paga interés. El avance sí, desde la primera cuota, y además
  carga su comisión en el primer extracto. El avance llega a la cuenta y suma al saldo.
- La cuota de manejo arranca en el primer extracto que falta por pagar al configurar la
  tarjeta: si el día de pago de este mes ya pasó, empieza el mes siguiente.
- Cada compra guarda la tasa con la que se hizo, así que cambiar la tasa de la tarjeta
  solo afecta las compras nuevas. La cuota de manejo cambia desde un mes en adelante,
  igual que los fijos.
- "Pagar todo" liquida el saldo de una compra en el próximo extracto pendiente.
- "Ya pagué la cuota N" marca una cuota pagada por fuera de la libreta (por adelantado o
  antes de usarla); también se ajusta en Editar, campo "Cuotas ya pagadas". Esas cuotas
  salen de los extractos y de la deuda, y no mueven el saldo.
- Toda compra o avance se puede editar (tipo, concepto, categoría, monto, cuotas, fecha y
  tasa) desde la tarjeta, la lista de avances o Movimientos. El plan se recalcula; los
  pagos de extractos ya registrados conservan lo que se pagó.
- Al registrar el pago se escribe lo que dice el extracto; si difiere del cálculo, manda
  el extracto.
- En el mes en curso la tarjeta muestra el extracto según la fecha de hoy: el que ya
  cortó y falta pagar ("Por pagar ahora", o "Vencido" si pasó su día de pago), y si no
  hay ninguno, el que está corriendo ("Extracto en curso"), que se puede pagar por
  adelantado. Debajo dice cuánto va para el siguiente. Cada compra dice en qué extracto
  va su próxima cuota y si ese extracto ya cortó.
- Un pago de la tarjeta sale del saldo del mes en que se hizo, aunque sea el extracto de
  otro mes: pagar el 20 de noviembre el extracto que vence el 3 de diciembre resta en
  noviembre.
- En "En qué se fue" las compras con tarjeta cuentan en el mes en que se hicieron, por su
  categoría, y del extracto solo se suma el costo de la tarjeta (intereses, manejo y
  comisiones), para no contar dos veces lo mismo.

Valores de referencia de la Mastercard Oro Bancolombia consultados en octubre de 2026:
cuota de manejo de $36.990 al mes, tasa de 28,56% E.A. (2,1155% mensual) y avance por
app o sucursal virtual de $6.840 más IVA. Cambian cada mes; confírmelos en el extracto.

## Avances

En Bancolombia el avance se pide en la app (Transacciones > Avances y desembolsos) y
se transfiere a la cuenta de ahorros, a un plazo de hasta 24 cuotas. Se anotan desde
"Anotar un movimiento" con el tipo "Tarjeta · Avance a la cuenta", o desde la sección
Tarjeta. La plata suma al saldo el día que llega a la cuenta, la deuda se
paga en cuotas con intereses desde la primera, y la comisión se carga en el primer
extracto. La sección Tarjeta los lista aparte con lo que cuesta cada uno.

## Plata prestada

Prestar saca la plata del saldo del mes en que se entrega y cada abono que devuelven
entra como ingreso. Un préstamo se marca vencido cuando pasa la fecha acordada sin
pagarse del todo, y se puede dar por perdido sin borrar el rastro de lo devuelto.

## Fórmula del saldo

    entradas = ingresos + retiros de ahorro + avances + abonos de préstamos
    salidas  = gastos variables + fijos pagados + abonos a ahorro
               + pago de la tarjeta + plata prestada

    saldo del mes    = saldo inicial + entradas - salidas
    disponible real  = saldo - fijos pendientes - extracto de la tarjeta sin pagar

El ahorro es voluntario, así que solo resta lo que se abonó de verdad: la meta mensual
que quede sin abonar nunca entra en lo comprometido ni recorta el disponible.

El sueldo previsto tampoco toca el saldo. Se informa aparte (esperado, recibido y por
recibir) y solo suma cuando se registra el ingreso real, que puede ser por el monto
completo o por una parte. Si el trabajo se acaba, basta con dejar de registrarlo.

## Proyección del saldo

    punto de partida = saldo de hoy
    primer mes      += sueldo que falta por entrar este mes - lo pendiente de este mes
    cada mes        += sueldo previsto - fijos vigentes - extracto de la tarjeta
                       - gasto suelto promedio

El gasto suelto promedio son los gastos anotados más las compras con tarjeta de los
últimos tres meses con registros. La proyección no cuenta ahorros, que son voluntarios,
ni préstamos por cobrar, que no son seguros.

## Secciones, tema y gráficos

La sección abierta y el tema se recuerdan en el navegador. Cada sección tiene su propio
enlace (por ejemplo #tarjeta). Los gráficos usan una paleta revisada para daltonismo,
tanto en claro como en oscuro; cada color sigue siempre a la misma categoría, y la lista
al lado de la dona sirve de leyenda y de tabla con las cifras exactas.

## Presupuesto, patrimonio y avisos

- Presupuesto: un tope mensual por categoría (en "presupuestos" del JSON, rige todos los
  meses). Se mide contra el consumo del mes, el mismo de "En qué se fue". En el mes en
  curso, pasada la primera semana, calcula el ritmo: gastado / fracción del mes corrida,
  que es a cuánto cerraría si sigue igual. La línea punteada en la barra lo marca.
- Patrimonio = saldo + ahorros + lo que le deben − capital que debe en la tarjeta, al
  cierre de cada mes. Sale como cifra en el Resumen y como gráfico en Historia.
- Para revisar se calcula con reglas, sin IA: el extracto que vence en 5 días o venció,
  los fijos que suelen estar pagos a esta altura y no lo están, los que tocan en 3 días,
  préstamos vencidos o por vencer, topes pasados o en riesgo, fijos que subieron en los
  últimos dos meses y gastos que se repiten en distintos meses por un monto parecido
  sin estar como fijos (con un botón para volverlos fijos desde el mes siguiente).
  La × oculta un aviso para siempre en ese equipo.
- Notificaciones: al abrir la app, una vez al día, Windows muestra los pagos que piden
  atención. Salen a nombre de Windows PowerShell, porque Windows solo muestra
  notificaciones de aplicaciones registradas.
- Búsqueda: en Movimientos, el buscador deja el mes y busca en toda la historia por
  concepto, categoría o monto.

## Asistente con OpenAI

Se activa ingresando la clave desde Configuración. Windows la guarda para el perfil activo.
El propietario que importa la libreta anterior también conserva acceso a la configuración
heredada del archivo `.env` (hay una plantilla en `.env.ejemplo`):

    OPENAI_API_KEY=sk-...
    OPENAI_MODEL=gpt-6-luna

El modelo es opcional y se puede cambiar por cualquiera de la API Responses. El .env se
lee en cada consulta, así que no hace falta reiniciar.

Cómo cuida los datos:

- La interfaz envía la clave al servidor local al guardarla. Las respuestas del
  servidor informan el estado de la configuración sin devolver la clave.
- Las consultas a la API Responses se envían con `store: false`.
- A OpenAI solo viajan las cifras que cada consulta necesita.
- Nada se anota sin confirmar: lo que el modelo entiende llega como propuesta editable,
  marca lo que parece repetido y solo se guarda lo que se deja marcado.

Qué hace:

- Anotar con palabras: "ayer almorcé 25 mil con la tarjeta y le presté 50 mil a
  Andrés" se vuelve una compra con tarjeta y un préstamo. Entiende gastos, compras a
  cuotas, avances, ingresos, préstamos, abonos de préstamos y movimientos de ahorro.
- Leer documentos: una foto de un recibo o el PDF del extracto de la tarjeta. Del
  extracto toma las compras y avances con sus cuotas, y deja fuera pagos, intereses y
  manejo, que la libreta ya calcula.
- Pregúntele a sus cuentas: una conversación en la que el modelo consulta los datos con
  herramientas que corren en el navegador, con las mismas funciones que pintan la app
  (resumen del mes, movimientos, tarjeta, simular una compra, préstamos, proyección,
  historia, fijos y sueldo). Así sus cifras son las mismas que se ven en pantalla.
- Además, con dos casillas bajo el chat (se recuerdan en el equipo):
  - Buscar en internet (herramienta web_search de OpenAI): TRM, tasas, precios,
    noticias. Responde con enlace a la fuente, que abre en el navegador. Se le pide no
    poner datos personales en las búsquedas.
  - Ejecutar código (code_interpreter): Python en un espacio aislado de OpenAI para
    cálculos largos, gráficos y CSV. Python no ve la libreta: el modelo consulta las
    herramientas y escribe las cifras en el código. Los gráficos se ven en el chat y se
    pueden descargar (pasan por /api/ia/archivo); "Ver el código que corrió" muestra el
    código y lo que imprimió. El espacio se borra a los ~20 minutos sin uso.
  Ambas cuestan aparte en OpenAI (cada búsqueda y cada espacio de Python); desmarcarlas
  las apaga.
- Lectura del mes: en el Resumen, el botón "Analizar el mes" compara con los meses
  anteriores y devuelve de tres a cinco hallazgos marcados como bien, atención o alerta.

Es un análisis de los datos propios, no asesoría financiera profesional.

## La barra del encabezado

Los tramos, en orden: lo ya gastado, lo apartado en ahorro, los fijos que faltan por
pagar, lo que falta para la meta de ahorro, lo libre y el sueldo previsto.

El ahorro va en oro, nunca en el rojo de los fijos pendientes: apartar plata no es
gastarla ni deberla. El tramo punteado en oro es lo que falta para la meta del mes y
muerde la parte libre, porque es dinero que sigue estando pero dejaría de estar
disponible si lo aparta. El tramo gris punteado del final es el sueldo previsto, y la
línea vertical de puntos marca hasta dónde llega lo que ya está en la mano, rotulada con
el disponible sin ese ingreso.

Debajo se listan los escenarios con su cifra: libre hoy, si abona el ahorro, si entra el
sueldo, y con ambas cosas. Cada tramo y cada escenario aparece solo cuando aplica, así
que sin sueldo ni ahorro configurados la barra se ve como al principio.

El saldo inicial de un mes es el cierre del último mes con registros, salvo que haya un
valor escrito a mano en saldoInicial para ese mes, que corta la herencia y se vuelve la
nueva base para los meses siguientes.

El acumulado de un ahorro es su valor inicial, más los aportes mensuales marcados hasta
ese mes, más los aportes sueltos asignados, menos los retiros. No se reinicia al cambiar
de mes.
