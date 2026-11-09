import { CONFIG } from "./config.js"; // CAMBIO 1: quité el import de leerSesion, ya no se usa

/**
 * Cliente HTTP del backend del equipo. La URL base y el modo viven en
 * `config.js`. Con `URL_BASE` vacío y sin modo fijado, api.js usa el mock local.
 */
export const URL_BASE = CONFIG.URL_BASE || '';

export function modo() {
    if (CONFIG.modo === 'http')
        return 'http';
    if (CONFIG.modo === 'mock')
        return 'mock';
    return URL_BASE ? 'http' : 'mock';
}

async function pedir(ruta, opciones = {}) {
    // CAMBIO 1: quité "const sesion = leerSesion()". La sesión va en la cookie
    // FormData viaja sin Content-Type: el navegador pone el boundary del multipart.
    const esJson = typeof opciones.body === 'string';
    const res = await fetch(URL_BASE.replace(/\/$/, '') + ruta, {
        ...opciones,
        credentials: 'include', // CAMBIO 2: manda y guarda la cookie de sesión
        headers: {
            Accept: 'application/json',
            ...(esJson ? { 'Content-Type': 'application/json' } : {}),
            // CAMBIO 3: quité Authorization Bearer, el back lee la cookie, no ese header
            ...opciones.headers
        }
    });
    if (!res.ok) {
        let mensaje = `El servidor respondió ${res.status}.`;
        try {
            const c = await res.json();
            // CAMBIO 4: el back responde "message" (antes solo leía "mensaje")
            if (c?.message || c?.mensaje || c?.error)
                mensaje = c.message || c.mensaje || c.error;
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
    iniciarSesion: (email, password) => pedir('/api/login', json({ email, password })), // CAMBIO 5: ruta real del back
    registrarse: (d) => pedir('/auth/registro', json(d)), // pendiente: el back usa /register
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