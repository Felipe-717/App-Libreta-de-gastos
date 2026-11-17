import hashlib
import hmac
import secrets

import almacen


def preparar(con):
    con.executescript('''
        CREATE TABLE IF NOT EXISTS instalacion (unica INTEGER PRIMARY KEY CHECK(unica = 1), id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
            sal BLOB NOT NULL, clave BLOB NOT NULL, legado INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sesiones (
            token BLOB PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE
        );
    ''')
    con.execute('INSERT OR IGNORE INTO instalacion VALUES (1, ?)', (secrets.token_hex(16),))
    con.commit()


def instalacion(con):
    return con.execute('SELECT id FROM instalacion WHERE unica = 1').fetchone()[0]


def derivar(clave, sal):
    return hashlib.scrypt(clave.encode('utf-8'), salt=sal, n=16384, r=8, p=1, dklen=32)


def credenciales(cuerpo):
    if not isinstance(cuerpo, dict):
        raise ValueError('Datos de acceso no válidos')
    nombre, clave = cuerpo.get('usuario'), cuerpo.get('contrasena')
    if not isinstance(nombre, str) or not 1 <= len(nombre.strip()) <= 40 or any(ord(c) < 32 for c in nombre):
        raise ValueError('El usuario debe tener entre 1 y 40 caracteres')
    if not isinstance(clave, str) or not 8 <= len(clave) <= 1024:
        raise ValueError('La contraseña debe tener entre 8 y 1024 caracteres')
    return nombre.strip(), clave


def nueva_sesion(con, usuario_id):
    token = secrets.token_urlsafe(32)
    con.execute('INSERT INTO sesiones VALUES (?, ?)', (hashlib.sha256(token.encode()).digest(), usuario_id))
    return token


def registrar(con, cuerpo, ruta_json):
    nombre, clave = credenciales(cuerpo)
    sal = secrets.token_bytes(16)
    derivada = derivar(clave, sal)
    con.execute('BEGIN IMMEDIATE')
    try:
        primero = not con.execute('SELECT 1 FROM usuarios LIMIT 1').fetchone()
        legado = primero and ruta_json.exists()
        usuario_id = con.execute('INSERT INTO usuarios (nombre, sal, clave, legado) VALUES (?, ?, ?, ?)',
                                 (nombre, sal, derivada, int(legado))).lastrowid
        try:
            almacen.inicializar_usuario(con, usuario_id, ruta_json, importar=legado)
        except (ValueError, OSError) as exc:
            if not legado:
                raise
            raise ValueError('No se pudo importar gastos.json. Revise el archivo o recupere un respaldo antes de crear el perfil.') from exc
        token = nueva_sesion(con, usuario_id)
        con.commit()
        return nombre, token
    except BaseException:
        con.rollback()
        raise


def ingresar(con, cuerpo):
    nombre, clave = credenciales(cuerpo)
    fila = con.execute('SELECT id, nombre, sal, clave FROM usuarios WHERE nombre = ?', (nombre,)).fetchone()
    # Derivar incluso para usuarios desconocidos evita una diferencia evidente de tiempo.
    derivada = derivar(clave, fila[2] if fila else b'\0' * 16)
    if not fila or not hmac.compare_digest(derivada, fila[3]):
        raise ValueError('Usuario o contraseña incorrectos')
    token = nueva_sesion(con, fila[0])
    con.commit()
    return fila[1], token


def usuario(con, token):
    if not token or len(token) > 128:
        return None
    try:
        resumen = hashlib.sha256(token.encode('ascii')).digest()
    except UnicodeEncodeError:
        return None
    return con.execute('SELECT u.id, u.nombre, u.legado FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token=?', (resumen,)).fetchone()


def salir(con, token):
    if token:
        try:
            con.execute('DELETE FROM sesiones WHERE token=?', (hashlib.sha256(token.encode('ascii')).digest(),))
            con.commit()
        except UnicodeEncodeError:
            pass
