"""Servidor local para la libreta de gastos.

Uso:
    python servidor.py        en el navegador, con terminal
    app.pyw                   en su propia ventana, sin terminal

Abre http://127.0.0.1:8756 y guarda los perfiles en la carpeta DATA_DIR.
"""

import hashlib
import json
import os
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from contextlib import closing
from datetime import datetime
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import agente
import almacen
import auth

# ---------------------------------------------------------------- configuración
BASE_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent

# Carpeta donde se guarda la información. Cambie esta ruta por la que quiera,
# por ejemplo Path.home() / "Documentos" / "Finanzas" o una carpeta sincronizada.
DATA_DIR = BASE_DIR / "datos"

ARCHIVO = DATA_DIR / "gastos.json"
STATIC_DIR = Path(__file__).resolve().parent / "static"

HOST = "127.0.0.1"
PUERTO = 8756
ABRIR_NAVEGADOR = True

DB = DATA_DIR / "gastos.sqlite3"
INSTALACION = None
_intentos = []
_lock = threading.Lock()


def preparar():
    global INSTALACION
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with closing(almacen.conectar(DB)) as con:
        almacen.preparar(con)
        auth.preparar(con)
        INSTALACION = auth.instalacion(con)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, formato, *args):
        if sys.stderr is not None and "/api/" in (self.path or ""):
            sys.stderr.write(f"{self.command} {urlparse(self.path).path}\n")

    def responder(self, codigo, cuerpo, cookie=None):
        payload = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", f"libreta_{INSTALACION}={cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age={315360000 if cookie else 0}")
        self.end_headers()
        self.wfile.write(payload)

    def host_valido(self):
        return self.headers.get("Host") == f"{HOST}:{self.server.server_address[1]}"

    def origen_json_valido(self):
        return (self.host_valido() and self.headers.get("Origin") == f"http://{HOST}:{self.server.server_address[1]}"
                and self.headers.get_content_type() == "application/json")

    def token(self):
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            valor = cookie.get(f"libreta_{INSTALACION}")
            return valor.value if valor else ""
        except CookieError:
            return ""

    def usuario(self):
        with closing(almacen.conectar(DB)) as con:
            return auth.usuario(con, self.token())

    def contexto(self):
        # Vincula las peticiones al perfil original de la pestaña aunque cambie la cookie.
        return hashlib.sha256(self.token().encode()).hexdigest()[:24]

    def contexto_valido(self, ruta):
        contexto = self.headers.get("X-Libreta-Sesion")
        if ruta == "/api/ia/archivo":
            contexto = parse_qs(urlparse(self.path).query).get("s", [""])[0]
        if contexto != self.contexto():
            self.responder(409, {"error": "La sesión cambió. Vuelva a abrir la libreta."})
            return False
        return True

    def cuerpo(self, maximo):
        largo = int(self.headers.get("Content-Length") or 0)
        if largo <= 0 or largo > maximo:
            raise ValueError("cuerpo vacío o demasiado grande")
        return json.loads(self.rfile.read(largo).decode("utf-8"))

    def do_HEAD(self):
        if not self.host_valido() or urlparse(self.path).path.startswith("/api/"):
            self.send_error(403)
            return
        super().do_HEAD()

    def do_GET(self):
        if not self.host_valido():
            self.responder(403, {"error": "host no permitido"})
            return
        ruta = urlparse(self.path).path
        if not ruta.startswith("/api/"):
            super().do_GET()
            return
        if ruta == "/api/perfiles":
            with closing(almacen.conectar(DB)) as con:
                self.responder(200, {"hayUsuarios": bool(con.execute("SELECT 1 FROM usuarios LIMIT 1").fetchone())})
            return
        usuario = self.usuario()
        if not usuario:
            self.responder(401, {"error": "Inicie sesión"})
            return
        if ruta == "/api/sesion":
            self.responder(200, {"usuario": usuario[1], "contexto": self.contexto()})
            return
        if not self.contexto_valido(ruta):
            return
        perfil = f"{INSTALACION}:{usuario[0]}"
        try:
            if ruta == "/api/datos":
                with closing(almacen.conectar(DB)) as con:
                    self.responder(200, almacen.leer(con, usuario[0]))
            elif ruta == "/api/ia/estado":
                self.responder(200, agente.estado(perfil=perfil, legado=bool(usuario[2])))
            elif ruta == "/api/ia/archivo":
                consulta = parse_qs(urlparse(self.path).query)
                contenido, tipo = agente.archivo(consulta.get("c", [""])[0], consulta.get("f", [""])[0], perfil=perfil, legado=bool(usuario[2]))
                self.send_response(200)
                self.send_header("Content-Type", tipo)
                self.send_header("Content-Length", str(len(contenido)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(contenido)
            else:
                self.responder(404, {"error": "ruta desconocida"})
        except agente.ErrorIA as exc:
            self.responder(exc.codigo, {"error": exc.mensaje})
        except (OSError, ValueError, sqlite3.Error, UnicodeError):
            self.responder(500, {"error": "No se pudo leer la libreta."})

    def do_POST(self):
        if not self.origen_json_valido():
            self.responder(403, {"error": "origen o tipo de contenido no permitido"})
            return
        ruta = urlparse(self.path).path
        if ruta in ("/api/registro", "/api/ingreso"):
            with _lock:
                ahora = time.monotonic()
                _intentos[:] = [t for t in _intentos if ahora - t < 60]
                if len(_intentos) >= 10:
                    self.responder(429, {"error": "Demasiados intentos. Espere un minuto."})
                    return
                _intentos.append(ahora)
            try:
                cuerpo = self.cuerpo(8192)
                with closing(almacen.conectar(DB)) as con:
                    nombre, token = (auth.registrar(con, cuerpo, ARCHIVO) if ruta == "/api/registro" else auth.ingresar(con, cuerpo))
                self.responder(200, {"usuario": nombre}, token)
            except sqlite3.IntegrityError:
                self.responder(400, {"error": "El usuario ya existe"})
            except (ValueError, UnicodeError) as exc:
                self.responder(400, {"error": str(exc)})
            except (OSError, sqlite3.Error):
                self.responder(500, {"error": "No se pudo crear o abrir el perfil"})
            return
        usuario = self.usuario()
        if not usuario:
            self.responder(401, {"error": "Inicie sesión"})
            return
        if not self.contexto_valido(ruta):
            return
        if ruta == "/api/salir":
            with closing(almacen.conectar(DB)) as con:
                auth.salir(con, self.token())
            self.responder(200, {"ok": True}, "")
            return
        try:
            if ruta == "/api/notificar":
                cuerpo = self.cuerpo(20_000)
                notificar(str(cuerpo.get("titulo", ""))[:120], str(cuerpo.get("texto", ""))[:300])
                self.responder(200, {"ok": True})
            elif ruta == "/api/ia":
                self.responder(200, agente.responder(self.cuerpo(40_000_000), perfil=f"{INSTALACION}:{usuario[0]}", legado=bool(usuario[2])))
            else:
                self.responder(404, {"error": "ruta desconocida"})
        except agente.ErrorIA as exc:
            self.responder(exc.codigo, {"error": exc.mensaje})
        except (ValueError, UnicodeError, AttributeError) as exc:
            self.responder(400, {"error": str(exc)})

    def do_PUT(self):
        if not self.origen_json_valido():
            self.responder(403, {"error": "origen o tipo de contenido no permitido"})
            return
        usuario = self.usuario()
        if not usuario:
            self.responder(401, {"error": "Inicie sesión"})
            return
        ruta = urlparse(self.path).path
        if not self.contexto_valido(ruta):
            return
        try:
            if ruta == "/api/ia/clave":
                self.responder(200, agente.guardar_clave(self.cuerpo(4096), perfil=f"{INSTALACION}:{usuario[0]}", legado=bool(usuario[2])))
            elif ruta == "/api/datos":
                datos = almacen.validar(self.cuerpo(20_000_000))
                with closing(almacen.conectar(DB)) as con:
                    with con:
                        con.execute("BEGIN IMMEDIATE")
                        almacen.respaldar(con, usuario[0], DATA_DIR)
                        almacen.guardar(con, usuario[0], datos)
                self.responder(200, {"guardado": datetime.now().isoformat(timespec="seconds")})
            else:
                self.responder(404, {"error": "ruta desconocida"})
        except agente.ErrorIA as exc:
            self.responder(exc.codigo, {"error": exc.mensaje})
        except (ValueError, UnicodeError) as exc:
            self.responder(400, {"error": str(exc)})
        except (OSError, sqlite3.Error):
            self.responder(500, {"error": "No se pudo guardar la libreta."})


# Notificación nativa de Windows con PowerShell, sin dependencias. El título y el
# texto viajan por variables de entorno y se escapan como XML, así no hay forma de
# que un concepto con comillas se vuelva código. Sale a nombre de PowerShell porque
# Windows solo muestra notificaciones de aplicaciones registradas.
_TOAST = r"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [System.Security.SecurityElement]::Escape($env:LIBRETA_TITULO)
$x = [System.Security.SecurityElement]::Escape($env:LIBRETA_TEXTO)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>Libreta de gastos: $t</text><text>$x</text></binding></visual></toast>")
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
"""


def notificar(titulo, texto):
    if sys.platform != "win32" or not titulo:
        return
    entorno = dict(os.environ, LIBRETA_TITULO=titulo, LIBRETA_TEXTO=texto)
    subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command", _TOAST], env=entorno,
                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def puerto_libre(puerto):
    with socket.socket() as s:
        return s.connect_ex((HOST, puerto)) != 0


def crear_servidor():
    """Prepara la carpeta y deja el servidor listo en el primer puerto libre."""
    preparar()
    puerto = PUERTO
    while not puerto_libre(puerto) and puerto < PUERTO + 20:
        puerto += 1
    servidor = ThreadingHTTPServer((HOST, puerto), Handler)
    servidor.daemon_threads = True
    return servidor, f"http://{HOST}:{puerto}"


def main():
    servidor, url = crear_servidor()
    print("Libreta de gastos en marcha")
    print(f"  Interfaz: {url}")
    print(f"  Datos:    {DB}")
    print("  Detener:  Ctrl+C")
    if ABRIR_NAVEGADOR:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido. Los datos quedaron guardados.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
