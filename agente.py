"""Puente con la API de OpenAI para el asistente de la libreta.

La clave se guarda en el Administrador de credenciales de Windows o se lee de
.env. El navegador la envía al guardarla, pero no puede volver a consultarla.
El navegador arma cada consulta y ejecuta las
herramientas sobre los datos, y este módulo solo la reenvía a la API Responses
con el modelo configurado. No usa dependencias externas.

Archivo .env:
    OPENAI_API_KEY=sk-...
    OPENAI_MODEL=gpt-6-luna      (opcional)
    OPENAI_BASE_URL=...            (opcional, para un servicio compatible)
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
import credenciales

BASE_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
ARCHIVO_ENV = BASE_DIR / ".env"
URL_POR_DEFECTO = "https://api.openai.com/v1"
MODELO_POR_DEFECTO = "gpt-6-luna"

# Lo único que el navegador puede decidir de la consulta. El modelo, el
# almacenamiento y la clave los pone el servidor.
CAMPOS_PERMITIDOS = {"input", "instructions", "tools", "tool_choice", "text", "reasoning",
                     "max_output_tokens", "parallel_tool_calls"}


class ErrorIA(Exception):
    def __init__(self, codigo, mensaje):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje


def leer_env():
    valores = {}
    if ARCHIVO_ENV.exists():
        for linea in ARCHIVO_ENV.read_text(encoding="utf-8-sig").splitlines():
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            clave, valor = linea.split("=", 1)
            valores[clave.strip()] = valor.strip().strip('"').strip("'")
    return valores


def configuracion(*, perfil, legado=False):
    """Solo el propietario de los datos anteriores conserva la configuración heredada."""
    env = leer_env() if legado else {}
    try:
        clave = credenciales.leer(perfil)
        if not clave and legado:
            clave = credenciales.leer() or env.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    except (OSError, UnicodeError) as exc:
        raise ErrorIA(500, "No se pudo leer la clave guardada de Windows") from exc
    modelo = env.get("OPENAI_MODEL") or (os.environ.get("OPENAI_MODEL") if legado else None) or MODELO_POR_DEFECTO
    base = env.get("OPENAI_BASE_URL") or (os.environ.get("OPENAI_BASE_URL") if legado else None) or URL_POR_DEFECTO
    return clave, modelo, base.rstrip("/") + "/responses"


def razona(modelo):
    """Los modelos de razonamiento aceptan esfuerzo y devuelven su razonamiento cifrado.
    Desde GPT-5 todos razonan; los anteriores no."""
    return not modelo.startswith(("gpt-4", "gpt-3", "chatgpt-4"))


def estado(*, perfil, legado=False):
    clave, modelo, _ = configuracion(perfil=perfil, legado=legado)
    return {"configurada": bool(clave), "modelo": modelo}


def guardar_clave(cuerpo, *, perfil, legado=False):
    clave = cuerpo.get("clave") if isinstance(cuerpo, dict) else None
    if not isinstance(clave, str) or not clave or len(clave) > 1000 or any(c.isspace() or ord(c) < 32 or ord(c) > 126 for c in clave):
        raise ErrorIA(400, "Ingrese una clave válida, sin espacios")
    try:
        credenciales.guardar(clave, perfil)
    except OSError as exc:
        raise ErrorIA(500, str(exc)) from exc
    return estado(perfil=perfil, legado=legado)


def responder(cuerpo, *, perfil, legado=False):
    clave, modelo, url = configuracion(perfil=perfil, legado=legado)
    if not clave:
        raise ErrorIA(400, "Configure la clave de OpenAI en el asistente")
    if not isinstance(cuerpo, dict) or "input" not in cuerpo:
        raise ErrorIA(400, "la consulta necesita input")

    payload = {k: v for k, v in cuerpo.items() if k in CAMPOS_PERMITIDOS}
    # store=False: OpenAI no guarda las conversaciones. Para que las herramientas
    # funcionen sin estado, los modelos de razonamiento devuelven su razonamiento
    # cifrado y el navegador lo reenvía en la siguiente vuelta.
    payload.update(model=modelo, store=False)
    incluir = []
    if razona(modelo):
        incluir.append("reasoning.encrypted_content")
    else:
        payload.pop("reasoning", None)
    # Con las herramientas de OpenAI (búsqueda web y Python) se piden también las
    # fuentes consultadas y lo que imprimió el código, para mostrarlos en el chat.
    tipos = {h.get("type") for h in payload.get("tools") or [] if isinstance(h, dict)}
    if "web_search" in tipos:
        incluir.append("web_search_call.action.sources")
    if "code_interpreter" in tipos:
        incluir.append("code_interpreter_call.outputs")
    if incluir:
        payload["include"] = incluir

    pedido = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {clave}", "Content-Type": "application/json"})
    return _abrir(pedido, json.load)


def archivo(contenedor, id_archivo, *, perfil, legado=False):
    """Un archivo que creó el código del asistente (un gráfico, un CSV) en su
    contenedor de OpenAI. Los contenedores se borran solos tras ~20 minutos sin uso."""
    clave, _, url = configuracion(perfil=perfil, legado=legado)
    if not clave:
        raise ErrorIA(400, "Configure la clave de OpenAI en el asistente")
    if not re.fullmatch(r"cntr_[A-Za-z0-9]+", contenedor or "") or not re.fullmatch(r"cfile_[A-Za-z0-9]+", id_archivo or ""):
        raise ErrorIA(400, "identificador de archivo no válido")
    base = url.removesuffix("/responses")
    pedido = urllib.request.Request(f"{base}/containers/{contenedor}/files/{id_archivo}/content",
                                    headers={"Authorization": f"Bearer {clave}"})
    return _abrir(pedido, lambda r: (r.read(), r.headers.get("Content-Type") or "application/octet-stream"))


def _abrir(pedido, leer):
    try:
        with urllib.request.urlopen(pedido, timeout=180) as r:
            return leer(r)
    except urllib.error.HTTPError as exc:
        detalle = exc.read().decode("utf-8", errors="replace")
        try:
            mensaje = json.loads(detalle)["error"]["message"]
        except (ValueError, KeyError, TypeError):
            mensaje = detalle[:300]
        raise ErrorIA(exc.code, mensaje)
    except urllib.error.URLError as exc:
        raise ErrorIA(502, f"No hay conexión con OpenAI: {exc.reason}")
    except TimeoutError:
        raise ErrorIA(504, "OpenAI tardó demasiado en responder")
