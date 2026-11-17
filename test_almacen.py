import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import almacen
import auth


class AlmacenTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ruta = Path(self.temp.name)
        self.con = almacen.conectar(self.ruta / "libreta.sqlite3")
        self.addCleanup(self.con.close)
        almacen.preparar(self.con)
        self.con.execute("CREATE TABLE usuarios (id INTEGER PRIMARY KEY)")
        self.con.commit()

    def test_importa_primera_libreta_y_aisla_usuario(self):
        original = dict(almacen.VACIO, movimientos=[{"id": "a", "monto": 10}, {"id": "b"}],
                        fijos=[{"nombre": "luz"}], extra={"arbitrario": [1, 2]})
        archivo = self.ruta / "gastos.json"
        archivo.write_text(json.dumps(original), encoding="utf-8")
        with self.con:
            self.con.execute("INSERT INTO usuarios VALUES (1)")
            almacen.inicializar_usuario(self.con, 1, archivo, importar=True)
            self.con.execute("INSERT INTO usuarios VALUES (2)")
            almacen.inicializar_usuario(self.con, 2, archivo)
        self.assertEqual(almacen.leer(self.con, 1), original)
        self.assertEqual(almacen.leer(self.con, 2), almacen.VACIO)
        with self.con:
            almacen.guardar(self.con, 2, dict(almacen.VACIO, movimientos=[{"monto": 33}]))
        self.assertEqual(almacen.leer(self.con, 1), original)
        self.assertEqual(json.loads(archivo.read_text(encoding="utf-8")), original)
        self.con.close()
        self.con = almacen.conectar(self.ruta / "libreta.sqlite3")
        self.addCleanup(self.con.close)
        self.assertEqual(almacen.leer(self.con, 1), original)

    def test_importacion_invalida_revierte_usuario_y_preserva_json(self):
        archivo = self.ruta / "gastos.json"
        for contenido in ('{', '[]', '{"movimientos": "invalido"}'):
            archivo.write_text(contenido, encoding="utf-8")
            with self.assertRaises(ValueError):
                with self.con:
                    self.con.execute("INSERT INTO usuarios VALUES (1)")
                    almacen.inicializar_usuario(self.con, 1, archivo, importar=True)
            self.assertEqual(self.con.execute("SELECT count(*) FROM usuarios").fetchone()[0], 0)
            self.assertEqual(archivo.read_text(encoding="utf-8"), contenido)

    def test_guardado_invalido_no_pierde_datos_y_transaccion_revierte(self):
        with self.con:
            almacen.inicializar_usuario(self.con, 1, self.ruta / "inexistente")
        with self.assertRaises(ValueError):
            with self.con:
                almacen.guardar(self.con, 1, {"movimientos": []})
        self.assertEqual(almacen.leer(self.con, 1), almacen.VACIO)
        with self.assertRaises(RuntimeError):
            with self.con:
                almacen.guardar(self.con, 1, dict(almacen.VACIO, movimientos=[{"monto": 9}]))
                raise RuntimeError("cancelar")
        self.assertEqual(almacen.leer(self.con, 1), almacen.VACIO)
        with self.assertRaises(ValueError):
            almacen.leer(self.con, 99)

    def test_legacy_incompleto_agrega_campos_predeterminados(self):
        archivo = self.ruta / "gastos.json"
        archivo.write_text('{"movimientos": [{"id": 1}], "extra": "conservar"}', encoding="utf-8")
        with self.con:
            almacen.inicializar_usuario(self.con, 1, archivo, importar=True)
        self.assertEqual(almacen.leer(self.con, 1), dict(almacen.VACIO, movimientos=[{"id": 1}], extra="conservar"))

    def test_guardado_incremental_y_respaldo(self):
        datos = dict(almacen.VACIO, movimientos=[{"id": 1}, {"id": 2}], extra="original")
        with self.con:
            almacen.guardar(self.con, 1, datos)
            cambios = self.con.total_changes
            almacen.guardar(self.con, 1, datos)
            self.assertEqual(self.con.total_changes, cambios)
            almacen.respaldar(self.con, 1, self.ruta)
            actualizado = dict(almacen.VACIO, movimientos=[{"id": 1}])
            almacen.guardar(self.con, 1, actualizado)
            almacen.respaldar(self.con, 1, self.ruta)
        self.assertEqual(almacen.leer(self.con, 1), actualizado)
        respaldo, = (self.ruta / "respaldos" / "1").glob("gastos_*.json")
        self.assertEqual(json.loads(respaldo.read_text(encoding="utf-8")), datos)

    def test_registro_no_deja_perfil_si_falla_importacion(self):
        datos = self.ruta / "gastos.json"
        datos.write_text('{"movimientos":', encoding="utf-8")
        otra = almacen.conectar(self.ruta / "registro.sqlite3")
        self.addCleanup(otra.close)
        almacen.preparar(otra)
        auth.preparar(otra)
        with self.assertRaisesRegex(ValueError, "No se pudo importar gastos.json"):
            auth.registrar(otra, {"usuario": "Prueba", "contrasena": "perfil-ficticio"}, datos)
        self.assertEqual(otra.execute("SELECT count(*) FROM usuarios").fetchone()[0], 0)
        self.assertEqual(otra.execute("SELECT count(*) FROM sesiones").fetchone()[0], 0)
        self.assertEqual(datos.read_text(encoding="utf-8"), '{"movimientos":')


if __name__ == "__main__":
    unittest.main()
