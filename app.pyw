"""La libreta en su propia ventana de escritorio, sin terminal.

Se abre con el acceso directo del escritorio (ver instalar.ps1), que lo lanza con el
pythonw del entorno .venv. Al cerrar la ventana se guarda lo pendiente y se apaga el
servidor, así que no queda nada corriendo.
"""

import ctypes
import os
import sys
import threading
from pathlib import Path

import webview

sys.path.insert(0, str(Path(__file__).resolve().parent))
import servidor  # noqa: E402

TITULO = "Libreta de gastos"
ICONO = Path(__file__).resolve().parent / "static" / "icono.ico"


def ya_abierta():
    """Una sola instancia: si ya hay una ventana, se trae al frente y se sale."""
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    ctypes.set_last_error(0)
    kernel32.CreateMutexW(None, False, "LibretaDeGastos.Instancia")
    if ctypes.get_last_error() != 183:          # ERROR_ALREADY_EXISTS
        return False
    user32 = ctypes.windll.user32
    hwnd = user32.FindWindowW(None, TITULO)
    if hwnd:
        user32.ShowWindow(hwnd, 9)               # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
    return True


def main():
    if sys.platform == "win32":
        if ya_abierta():
            return
        # Así Windows agrupa la ventana con su propio ícono y no con el de Python.
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Finanzas.LibretaDeGastos")

    # Para "Descargar copia" y los gráficos o CSV del asistente (se guardan en Descargas).
    # Los enlaces a internet, como las fuentes del asistente, abren en el navegador.
    webview.settings["ALLOW_DOWNLOADS"] = True
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True

    http, url = servidor.crear_servidor()
    threading.Thread(target=http.serve_forever, daemon=True).start()

    ventana = webview.create_window(TITULO, url, width=1280, height=900, min_size=(420, 600),
                                    background_color="#0D0E10", text_select=True)

    if sys.platform == "win32" and sys.getwindowsversion().build >= 22000:
        atributos = ctypes.windll.dwmapi.DwmSetWindowAttribute
        atributos.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]

        def colorear_marco(claro):
            hwnd = ventana.native.Handle.ToInt64()
            # DWM recibe COLORREF en orden BGR y conserva los botones del sistema.
            fondo, texto = (0xE8EEEC, 0x2B3016) if claro is True else (0x100E0D, 0xEDF0F1)
            for atributo, valor in ((20, int(claro is not True)), (35, fondo), (36, texto)):
                dato = ctypes.c_uint32(valor)
                atributos(hwnd, atributo, ctypes.byref(dato), ctypes.sizeof(dato))

        ventana.expose(colorear_marco)

    cerrando = threading.Event()

    def guardar_y_cerrar():
        try:
            ventana.evaluate_js("window.guardarAhora && guardarAhora()")
        except Exception:
            pass
        ventana.destroy()

    def al_cerrar():
        # Lo último que se anotó puede estar esperando su turno para guardarse. Se
        # cancela este cierre, se guarda desde otro hilo (evaluate_js necesita la
        # ventana libre) y luego se cierra de verdad.
        if cerrando.is_set():
            return True
        cerrando.set()
        threading.Thread(target=guardar_y_cerrar, daemon=True).start()
        return False

    ventana.events.closing += al_cerrar
    # Sin modo privado, la ventana recuerda entre sesiones el tema, la sección abierta,
    # los avisos descartados y si ya avisó hoy. Vive fuera de la carpeta de datos.
    almacen = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "LibretaDeGastos" / servidor.INSTALACION
    webview.start(icon=str(ICONO) if ICONO.exists() else None,
                  private_mode=False, storage_path=str(almacen))
    http.shutdown()
    http.server_close()


if __name__ == "__main__":
    main()
