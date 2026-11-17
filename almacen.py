"""Persistencia de libretas aisladas por usuario en SQLite."""

import copy
import json
import sqlite3
from datetime import date
from pathlib import Path

VACIO = {"version": 3, "saldoInicial": {}, "fijos": [], "ahorros": [], "sueldos": [],
         "movimientos": [], "tarjeta": None, "compras": [], "prestamos": [], "presupuestos": {}}


def conectar(ruta):
    con = sqlite3.connect(ruta, timeout=10)
    con.execute("PRAGMA foreign_keys = ON")
    return con


def preparar(con):
    con.execute("""CREATE TABLE IF NOT EXISTS libreta_campos (
        usuario_id INTEGER NOT NULL, clave TEXT NOT NULL, valor TEXT NOT NULL,
        PRIMARY KEY (usuario_id, clave))""")
    con.execute("""CREATE TABLE IF NOT EXISTS libreta_listas (
        usuario_id INTEGER NOT NULL, clave TEXT NOT NULL, posicion INTEGER NOT NULL, valor TEXT NOT NULL,
        PRIMARY KEY (usuario_id, clave, posicion),
        FOREIGN KEY (usuario_id, clave) REFERENCES libreta_campos(usuario_id, clave) ON DELETE CASCADE)""")


def validar(datos):
    if not isinstance(datos, dict):
        raise ValueError("el cuerpo debe ser un objeto")
    if not isinstance(datos.get("movimientos"), list):
        raise ValueError("falta la lista de movimientos")
    if not isinstance(datos.get("fijos"), list):
        raise ValueError("falta la lista de fijos")
    for clave in ("ahorros", "sueldos", "compras", "prestamos"):
        if not isinstance(datos.get(clave, []), list):
            raise ValueError(f"{clave} debe ser una lista")
    if not isinstance(datos.get("saldoInicial"), dict):
        raise ValueError("saldoInicial debe ser un objeto")
    if not isinstance(datos.get("presupuestos", {}), dict):
        raise ValueError("presupuestos debe ser un objeto")
    if datos.get("tarjeta") is not None and not isinstance(datos["tarjeta"], dict):
        raise ValueError("tarjeta debe ser un objeto")
    return datos


def guardar(con, usuario_id, datos):
    validar(datos)
    # Solo las listas conocidas se dividen en filas; las demás claves se conservan completas.
    listas = {"fijos", "ahorros", "sueldos", "movimientos", "compras", "prestamos"}
    campos = []
    filas = []
    for clave, valor in datos.items():
        if clave in listas:
            campos.append((usuario_id, clave, json.dumps([], ensure_ascii=False)))
            filas.extend((usuario_id, clave, i, json.dumps(v, ensure_ascii=False))
                         for i, v in enumerate(valor))
        else:
            campos.append((usuario_id, clave, json.dumps(valor, ensure_ascii=False)))
    anteriores = con.execute("SELECT clave FROM libreta_campos WHERE usuario_id = ?",
                             (usuario_id,)).fetchall()
    con.executemany("DELETE FROM libreta_campos WHERE usuario_id = ? AND clave = ?",
                    ((usuario_id, clave) for (clave,) in anteriores if clave not in datos))
    con.executemany("""INSERT INTO libreta_campos VALUES (?, ?, ?)
        ON CONFLICT(usuario_id, clave) DO UPDATE SET valor = excluded.valor
        WHERE libreta_campos.valor <> excluded.valor""", campos)
    con.executemany("""INSERT INTO libreta_listas VALUES (?, ?, ?, ?)
        ON CONFLICT(usuario_id, clave, posicion) DO UPDATE SET valor = excluded.valor
        WHERE libreta_listas.valor <> excluded.valor""", filas)
    con.executemany("DELETE FROM libreta_listas WHERE usuario_id = ? AND clave = ? AND posicion >= ?",
                    ((usuario_id, clave, len(datos[clave])) for clave in listas if clave in datos))


def leer(con, usuario_id):
    filas = con.execute("""SELECT c.clave, c.valor, l.valor
        FROM libreta_campos c LEFT JOIN libreta_listas l
        ON c.usuario_id = l.usuario_id AND c.clave = l.clave
        WHERE c.usuario_id = ? ORDER BY c.clave, l.posicion""", (usuario_id,)).fetchall()
    if not filas:
        raise ValueError("no existe la libreta del usuario")
    datos = {}
    for clave, campo, valor in filas:
        if clave not in datos:
            datos[clave] = json.loads(campo)
        if valor is not None:
            datos[clave].append(json.loads(valor))
    return validar(datos)


def respaldar(con, usuario_id, carpeta_datos):
    respaldos = carpeta_datos / "respaldos" / str(usuario_id)
    respaldos.mkdir(parents=True, exist_ok=True)
    destino = respaldos / f"gastos_{date.today().isoformat()}.json"
    if not destino.exists():
        temporal = destino.with_suffix(".tmp")
        temporal.write_text(json.dumps(leer(con, usuario_id), ensure_ascii=False, indent=2), encoding="utf-8")
        temporal.replace(destino)
    for anterior in sorted(respaldos.glob("gastos_*.json"))[:-30]:
        anterior.unlink(missing_ok=True)


def inicializar_usuario(con, usuario_id, ruta_json, importar=False):
    datos = copy.deepcopy(VACIO)
    if importar and Path(ruta_json).exists():
        with Path(ruta_json).open(encoding="utf-8") as archivo:
            datos = json.load(archivo)
        if not isinstance(datos, dict):
            raise ValueError("el archivo no contiene un objeto")
        for clave, valor in VACIO.items():
            datos.setdefault(clave, copy.deepcopy(valor))
        validar(datos)
    guardar(con, usuario_id, datos)
