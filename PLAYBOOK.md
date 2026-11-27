# Playbook de defensa — PokéVault (SecurityProyect_2026)

Documento requerido para el proyecto del curso **Seguridad en Entorno de Desarrollo** (UCA).
Describe los requerimientos, la infraestructura, y las vulnerabilidades introducidas a
propósito en el sitio, con los pasos exactos para explotarlas.

> Universidad Centroamericana "José Simeón Cañas" — Facultad de Ingeniería y Arquitectura.
> App: **PokéVault**, tienda web de cartas Pokémon con publicaciones de la comunidad.

---

## 1. Requerimientos (herramientas, software y librerías)

### Software base del servidor

| Componente | Versión | Uso |
|---|---|---|
| Ubuntu Server | 24.04 LTS (o 26.04 LTS) | Sistema operativo de la VM |
| Node.js | 22.x (acepta 18+) | Entorno de ejecución del backend |
| PostgreSQL | 16+ (según la distro) | Base de datos (driver directo, sin ORM) |
| Nginx | 1.24+ | Proxy inverso y servidor del frontend estático |
| VirtualBox | 7.x | Hipervisor de la VM |
| Git | cualquiera | Clonado del repositorio |

### Librerías del backend (Node.js)

| Librería | Versión | Uso |
|---|---|---|
| express | ^5.3.0 | Framework web / rutas |
| pg | ^8.23.1 | Driver de PostgreSQL (consultas parametrizadas) |
| argon2 | ^0.45.2 | Hash de contraseñas |
| jsonwebtoken | ^9.0.3 | Sesión con JWT (HS256) |
| cookie-parser | ^1.4.7 | Lectura de la cookie de sesión |
| cors | ^2.8.6 | Control de origen cruzado |
| multer | ^2.5.0 | Recepción de la foto subida |
| dotenv | ^18.0.9 | Variables de entorno |

### Frontend

HTML, CSS y JavaScript (vanilla, sin framework). No se usan WordPress, Firebase, ORMs ni
frameworks prohibidos por la definición del proyecto.

### Herramientas usadas para probar / explotar

- **Navegador con DevTools** (F12): consola y pestaña de red.
- **Burp Suite**: interceptar y modificar peticiones (subida de archivos).
- **curl**: pruebas desde la terminal.
- **Nmap** (reconocimiento, visto en laboratorio): descubrir puertos y servicios.

---

## 2. Infraestructura

Despliegue **local** en una VM con Linux Server, sin exposición a internet. Todo lo
instala y configura el script `desplegar.sh` (instalación automatizada).

```
                 Red del laboratorio (cable Ethernet RJ-45)
                                  │
                     ┌────────────┴─────────────┐
                     │   VM Ubuntu Server        │
   Navegador  ──80──▶│  Nginx (proxy + estático) │
   (otra PC)         │        │                  │
                     │        ├─ archivos: Frontend/ (HTML/CSS/JS)
                     │        └─ /api,/productos,/usuarios,/facturas,/archivos
                     │               │ (solo 127.0.0.1:3000)
                     │        Backend Express (servicio systemd "pokevault")
                     │               │ (driver pg, 127.0.0.1)
                     │          PostgreSQL
                     └───────────────────────────┘
```

**Puntos clave de la infraestructura:**

- La VM usa **adaptador puente (Bridged)** sobre la interfaz Ethernet, para que las otras
  máquinas del laboratorio la alcancen por cable.
- **Nginx** escucha en el puerto **80** y es lo único expuesto a la red.
- El **backend Express** escucha solo en **127.0.0.1:3000** (no accesible desde fuera; solo
  Nginx le habla).
- **PostgreSQL** escucha solo en localhost.
- El backend corre como **servicio systemd** aislado (sin privilegios extra).
- **Firewall UFW**: solo abiertos SSH (con límite de intentos) y el puerto 80.
- La base de datos usa un usuario con **permisos mínimos** (solo lee/escribe datos, no puede
  alterar el esquema).

Usuarios de prueba por rol (para que el instructor verifique los roles):

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@pokevault.local` | `$PKadmin67$` |
| Vendedor | `vendedor@pokevault.local` | `$PKvendedor67$` |
| Comprador | `comprador@pokevault.local` | `$PKcomprador67$` |

---

## 3. Vulnerabilidades implementadas y cómo explotarlas

Se introdujeron **dos** vulnerabilidades a propósito, una de código y una de servidor. El
resto de la aplicación está endurecido. Ambas están marcadas en el código con el comentario
`VULN`.

> Para quien ataca, las pistas están en el diseño, no escritas: el folio de la factura es
> visible y secuencial, y la subida se explota interceptando la petición.

---

### 3.1 Vulnerabilidad de CÓDIGO — IDOR (Insecure Direct Object Reference)

**Clasificación:** control de acceso roto (IDOR) — CWE-639 / OWASP A01.

**Ubicación:** `backend/routes/facturas.js`, endpoint `GET /facturas/:folio`
(comentario `// VULN IDOR`).

**Descripción:** el endpoint devuelve una factura comprobando solo que el folio exista, sin
verificar que pertenezca al usuario autenticado. Los folios son **secuenciales**
(`PV-2026-0001`, `0002`, ...), así que son adivinables.

**Cómo se introdujo:** se quitó la verificación de propietario. El código correcto llevaría
`if (!puedeVer(f, req.user)) return res.status(404)` y esa línea se omitió a propósito.

**Pasos para explotarla (reconocimiento → explotación → impacto):**

1. **Reconocimiento:** registrarse en el sitio (correo cualquiera + contraseña) o entrar con
   una cuenta, hacer una compra y observar el folio propio: `PV-2026-00XX`. Se nota que es
   secuencial.
2. **Explotación:** estando con sesión iniciada, abrir la consola del navegador (F12 →
   Console) y pedir folios ajenos, empezando por los bajos:
   ```js
   fetch('/facturas/PV-2026-0001').then(r => r.json()).then(console.log)
   ```
   También se puede con `curl` reutilizando la cookie de sesión:
   ```bash
   curl -s -b "token=<COOKIE_DE_SESION>" http://IP_DE_LA_VM/facturas/PV-2026-0001
   ```
3. **Impacto (el golpe):** la respuesta trae la factura de **otra persona**, con sus datos
   personales (nombre, correo, dirección, DUI). Iterando el número
   (`0001`, `0002`, `0003`, ...) se puede **extraer la información de todas las facturas** del
   sistema. En la factura sembrada `PV-2026-0001` aparece además una **bandera** que confirma
   el hallazgo.

**Script de demostración (enumera varias facturas):**
```bash
for i in $(seq -w 1 10); do
  echo "== PV-2026-00$i =="
  curl -s -b "token=<COOKIE_DE_SESION>" "http://IP_DE_LA_VM/facturas/PV-2026-00$i"
  echo
done
```

**Mitigación:** validar la propiedad antes de responder (`if (!puedeVer(f, req.user)) return 404`),
y usar identificadores no predecibles.

---

### 3.2 Vulnerabilidad de SERVIDOR — Content-Type mal configurado (sin `nosniff`) → XSS almacenado

**Clasificación:** mala configuración de seguridad + XSS almacenado — CWE-79 / CWE-16 /
OWASP A03 y A05.

**Ubicación:**
- `desplegar.sh`, bloque `location` de `/uploads` en la configuración de Nginx
  (comentario `# VULN SERVIDOR`).
- `backend/routes/archivos.js`, lista de tipos aceptados (comentario `// VULN`).

**Descripción:** Nginx sirve los archivos subidos por usuarios **sin** la cabecera
`X-Content-Type-Options: nosniff` ni Content-Security-Policy, y la subida acepta archivos
**SVG**. Un SVG es texto y puede contener `<script>`, que el navegador ejecuta al abrir el
archivo como documento.

**Cómo se introdujo:** en la `location` de `/uploads` se agregó un `add_header` de caché que
(por la herencia de cabeceras de Nginx) hace que esa ruta pierda las cabeceras de seguridad
del resto del sitio; y la validación de la subida deja pasar `image/svg+xml`.

**Pasos para explotarla:**

1. **Reconocimiento:** iniciar sesión, ir a "Vender" y notar que se sube una foto. La subida
   normal solo deja imágenes, así que hay que atacar la petición directamente.
2. **Preparar el payload** — un archivo `payload.svg`:
   ```xml
   <svg xmlns="http://www.w3.org/2000/svg"><script>alert('XSS en '+document.domain)</script></svg>
   ```
3. **Subirlo** interceptando una subida normal de foto con **Burp** y reemplazando el archivo
   por el SVG (campo `archivo`, Content-Type `image/svg+xml`), o directo con `curl`:
   ```bash
   curl -s -b "token=<COOKIE_DE_SESION>" \
     -F "archivo=@payload.svg;type=image/svg+xml" \
     http://IP_DE_LA_VM/archivos
   ```
   Devuelve una URL tipo `/uploads/<hash>.svg`.
4. **Disparar el XSS:** abrir esa URL en el navegador (`http://IP_DE_LA_VM/uploads/<hash>.svg`).
   El script se ejecuta (salta el `alert` con el dominio del sitio).
5. **Comprobar la mala configuración:**
   ```bash
   curl -I http://IP_DE_LA_VM/uploads/<hash>.svg
   # no aparece "X-Content-Type-Options: nosniff"
   ```

**Impacto (el golpe):** XSS almacenado. Como el script corre en el **origen del sitio**,
tiene la sesión de quien abra el archivo y puede hacer peticiones autenticadas en su nombre.
PoC que demuestra el acceso a datos autenticados de la víctima:
```xml
<svg xmlns="http://www.w3.org/2000/svg"><script>
fetch('/api/me').then(r=>r.json()).then(d=>document.body.append('DATOS: '+JSON.stringify(d)))
</script></svg>
```
Si una víctima con sesión (por ejemplo un administrador) abre ese archivo, el script lee y
muestra sus datos de sesión; con la misma técnica podría ejecutar acciones de administrador.

**Mitigación:** rechazar SVG en la subida, servir `/uploads` con `X-Content-Type-Options:
nosniff` y una Content-Security-Policy con `sandbox`.

---

## 4. Resumen

| # | Tipo | Ubicación | Impacto | CWE |
|---|---|---|---|---|
| 1 | IDOR (código) | `GET /facturas/:folio` | Fuga de datos de todas las facturas | CWE-639 |
| 2 | Content-Type sin nosniff → XSS (servidor) | Nginx `/uploads` + `/archivos` | Ejecución de JS en el navegador de la víctima | CWE-79 / CWE-16 |

Todo lo demás de la aplicación (inyección SQL, fuerza bruta, escalada de privilegios,
manipulación de sesión, lectura de archivos internos) está mitigado.
