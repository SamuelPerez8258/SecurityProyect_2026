import { leerSesion } from "./sesion.js";
import { CONFIG } from "./config.js";

export const URL_BASE = CONFIG.URL_BASE || '';
export function modo() {
    if (CONFIG.modo === 'http')
        return 'http';
    if (CONFIG.modo === 'mock')
        return 'mock';
    return URL_BASE ? 'http' : 'mock';
}
async function pedir(ruta, opciones = {}) {
    const sesion = leerSesion();
    // FormData viaja sin Content-Type: el navegador pone el boundary del multipart.
    const esJson = typeof opciones.body === 'string';
    const res = await fetch(URL_BASE.replace(/\/$/, '') + ruta, {
        credentials: 'include',
        ...opciones,
        headers: {
            Accept: 'application/json',
            ...(esJson ? { 'Content-Type': 'application/json' } : {}),
            ...(sesion?.token ? { Authorization: `Bearer ${sesion.token}` } : {}),
            ...opciones.headers
        }
    });
    if (!res.ok) {
        let mensaje = `El servidor respondió ${res.status}.`;
        try {
            const c = await res.json();
            const m = c?.mensaje ?? c?.message ?? c?.error;
            if (m)
                mensaje = m;
        }
        catch {
            /* cuerpo no JSON */
        }
        throw new Error(mensaje);
    }
    if (res.status === 204)
        return undefined;
    return (await res.json());
}
const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });
export const http = {
   
        iniciarSesion: (email, password) => pedir('/api/login', json({ email, password })).then(r => ({ usuario: r.usuario, emitida: new Date().toISOString() })),
    registrarse: (d) => pedir('/register', json({ email: d.email, username: d.nombre, password: d.password, rol: d.rol || 'comprador' })).then(() => http.iniciarSesion(d.email, d.password)),
    sesionActual: () => pedir('/api/me'),
    cerrarSesion: () => pedir('/api/logout', { method: 'POST' }),
    
    
    
    productos: () => pedir('/productos'),
    crearProducto: (b) => pedir('/productos', json(b)),
    actualizarProducto: (id, p) => pedir(`/productos/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
    eliminarProducto: (id) => pedir(`/productos/${id}`, { method: 'DELETE' }),
    subirImagen: (archivo) => {
        const forma = new FormData();
        forma.append('archivo', archivo);
        return pedir('/archivos', { method: 'POST', body: forma });
    },
    usuarios: () => pedir('/usuarios'),
    crearUsuario: (d) => pedir('/usuarios', json(d)),
    actualizarUsuario: (id, p) => pedir(`/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
    eliminarUsuario: (id) => pedir(`/usuarios/${id}`, { method: 'DELETE' }),
    facturas: () => pedir('/facturas'),
    crearFactura: (lineas, comprador, pago, promo) => pedir('/facturas', json({ lineas, comprador, pago, promo })),
    notificarPago: (folio, aviso) => pedir(`/facturas/${folio}/avisos`, json(aviso)),
    cambiarEstadoPago: (folio, estado) => pedir(`/facturas/${folio}/estado`, json({ estado }))
};