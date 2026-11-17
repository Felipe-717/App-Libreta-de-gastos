import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import servidor


class ServidorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='.')
        self.dir = Path(self.tmp.name)
        self.patches = [patch.object(servidor, 'DATA_DIR', self.dir),
                        patch.object(servidor, 'ARCHIVO', self.dir / 'gastos.json'),
                        patch.object(servidor, 'DB', self.dir / 'gastos.sqlite3'),
                        patch.object(servidor, 'PUERTO', 0)]
        for p in self.patches:
            p.start()
        servidor._intentos.clear()
        self.iniciar()

    def iniciar(self):
        self.http, self.url = servidor.crear_servidor()
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.http.server_address[1]

    def detener(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()

    def tearDown(self):
        self.detener()
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def pedir(self, metodo, ruta, cuerpo=None, cookie='', origin=None, host=None, contexto=None):
        con = http.client.HTTPConnection('127.0.0.1', self.port)
        headers = {'Host': host or f'127.0.0.1:{self.port}'}
        if cuerpo is not None:
            headers.update({'Content-Type': 'application/json', 'Origin': origin or f'http://127.0.0.1:{self.port}'})
            cuerpo = json.dumps(cuerpo)
        if cookie:
            headers['Cookie'] = cookie
        if contexto:
            headers['X-Libreta-Sesion'] = contexto
        con.request(metodo, ruta, body=cuerpo, headers=headers)
        r = con.getresponse()
        resultado = r.status, json.loads(r.read()), r.getheader('Set-Cookie')
        con.close()
        return resultado

    def test_acceso_aislamiento_y_persistencia(self):
        with patch.object(servidor.sys, 'stderr', None):
            self.assertEqual(self.pedir('GET', '/api/perfiles')[:2], (200, {'hayUsuarios': False}))
        self.assertEqual(self.pedir('GET', '/api/datos')[0], 401)
        self.assertEqual(self.pedir('PUT', '/api/datos', {}, origin='http://malicioso')[0], 403)
        self.assertEqual(self.pedir('GET', '/api/datos', host='malicioso')[0], 403)
        estado, _, cookie = self.pedir('POST', '/api/registro', {'usuario':'Ana', 'contrasena':'password123'})
        self.assertEqual(estado, 200)
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Strict', cookie)
        cookie = cookie.split(';')[0]
        contexto = self.pedir('GET', '/api/sesion', cookie=cookie)[1]['contexto']
        datos = self.pedir('GET', '/api/datos', cookie=cookie, contexto=contexto)[1]
        datos['movimientos'].append({'concepto':'prueba'})
        self.assertEqual(self.pedir('PUT', '/api/datos', datos, cookie, contexto=contexto)[0], 200)
        self.detener()
        self.iniciar()
        self.assertEqual(self.pedir('GET', '/api/sesion', cookie=cookie)[1]['usuario'], 'Ana')
        estado, _, otra = self.pedir('POST', '/api/registro', {'usuario':'Bea', 'contrasena':'password456'})
        self.assertEqual(estado, 200)
        otra = otra.split(';')[0]
        otro_contexto = self.pedir('GET', '/api/sesion', cookie=otra)[1]['contexto']
        self.assertEqual(self.pedir('PUT', '/api/datos', datos, otra, contexto=contexto)[0], 409)
        self.assertEqual(self.pedir('GET', '/api/datos', cookie=otra, contexto=otro_contexto)[1]['movimientos'], [])
        self.assertEqual(self.pedir('GET', '/api/datos', cookie=cookie, contexto=contexto)[1]['movimientos'], [{'concepto':'prueba'}])
        with patch.object(servidor.agente, 'estado', return_value={'configurada': True}) as estado_ia:
            respuesta = self.pedir('GET', '/api/ia/estado', cookie=otra, contexto=otro_contexto)
            self.assertNotIn('password456', json.dumps(respuesta[1]))
            self.assertIn(':2', estado_ia.call_args.kwargs['perfil'])
        self.assertEqual(self.pedir('POST', '/api/salir', {}, cookie, contexto=contexto)[0], 200)
        self.assertEqual(self.pedir('GET', '/api/datos', cookie=cookie)[0], 401)
        self.assertEqual(self.pedir('POST', '/api/ingreso', {'usuario':'Ana', 'contrasena':'incorrecta'})[0], 400)
        self.assertEqual(self.pedir('POST', '/api/ingreso', {'usuario':'Ana', 'contrasena':'password123'})[0], 200)


if __name__ == '__main__':
    unittest.main()
