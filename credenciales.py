"""Almacenamiento de la clave en el Administrador de credenciales de Windows."""
import ctypes
import sys
from ctypes import wintypes

TARGET = "LibretaGastos/OpenAI"


class CREDENTIAL(ctypes.Structure):
    _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
                ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
                ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD),
                ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)), ("Persist", wintypes.DWORD),
                ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
                ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR)]


def _api():
    if sys.platform != "win32":
        raise OSError("El almacenamiento seguro requiere Windows")
    api = ctypes.WinDLL("Advapi32", use_last_error=True)
    api.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                              ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
    api.CredReadW.restype = wintypes.BOOL
    api.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIAL), wintypes.DWORD]
    api.CredWriteW.restype = wintypes.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    return api


def leer(perfil=None):
    if sys.platform != "win32":
        return ""
    api = _api()
    credencial = ctypes.POINTER(CREDENTIAL)()
    destino = f"{TARGET}/{perfil}" if perfil else TARGET
    if not api.CredReadW(destino, 1, 0, ctypes.byref(credencial)):
        if ctypes.get_last_error() == 1168:
            return ""
        raise OSError("No se pudo leer la clave del Administrador de credenciales")
    try:
        return ctypes.string_at(credencial.contents.CredentialBlob,
                                credencial.contents.CredentialBlobSize).decode("utf-16-le")
    finally:
        api.CredFree(credencial)


def guardar(clave, perfil):
    api = _api()
    blob = clave.encode("utf-16-le")
    buffer = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
    credencial = CREDENTIAL(Type=1, TargetName=f"{TARGET}/{perfil}", CredentialBlobSize=len(blob),
                            CredentialBlob=buffer, Persist=2, UserName="OpenAI")
    if not api.CredWriteW(ctypes.byref(credencial), 0):
        raise OSError("No se pudo guardar la clave en el Administrador de credenciales")
