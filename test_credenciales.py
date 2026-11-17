import unittest
from unittest.mock import patch

import agente
import credenciales


class ClaveTest(unittest.TestCase):
    def test_clave_aislada_y_compatibilidad_del_propietario(self):
        claves = {None: "anterior", "instalacion:1": "propietario"}
        with patch.object(credenciales, "leer", side_effect=lambda perfil=None: claves.get(perfil, "")), \
             patch.object(agente, "leer_env", return_value={"OPENAI_BASE_URL": "https://servicio.test/v1"}) as env:
            self.assertEqual(agente.configuracion(perfil="instalacion:2"),
                             ("", agente.MODELO_POR_DEFECTO, agente.URL_POR_DEFECTO + "/responses"))
            env.assert_not_called()
            self.assertEqual(agente.configuracion(perfil="instalacion:1", legado=True)[0], "propietario")
            del claves["instalacion:1"]
            self.assertEqual(agente.configuracion(perfil="instalacion:1", legado=True)[0], "anterior")

    def test_guardar_valida_y_no_devuelve_la_clave(self):
        with patch.object(credenciales, "guardar") as guardar, \
             patch.object(credenciales, "leer", return_value="clave-nueva"):
            estado = agente.guardar_clave({"clave": "clave-nueva"}, perfil="instalacion:2")
            guardar.assert_called_once_with("clave-nueva", "instalacion:2")
            self.assertEqual(estado, {"configurada": True, "modelo": agente.MODELO_POR_DEFECTO})
            for valor in ("", "con espacio", "x\n", 3, "x" * 1001):
                with self.assertRaises(agente.ErrorIA):
                    agente.guardar_clave({"clave": valor}, perfil="instalacion:2")
