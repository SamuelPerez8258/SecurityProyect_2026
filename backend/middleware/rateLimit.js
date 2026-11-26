const MAX_INTENTOS = 5;
const VENTANA = 15 * 60 * 1000;

// Intentos fallidos de login por IP. Un login correcto limpia el contador,
// asi cambiar de cuenta varias veces no bloquea a nadie.
const intentosPorIp = new Map();

function registro(ip) {
    const ahora = Date.now();
    const r = intentosPorIp.get(ip) ?? { count: 0, desde: ahora };
    if (ahora - r.desde > VENTANA) {
        r.count = 0;
        r.desde = ahora;
    }
    intentosPorIp.set(ip, r);
    return r;
}

function rateLimitLogin(req, res, next) {
    if (registro(req.ip).count >= MAX_INTENTOS) {
        return res.status(429).json({ message: 'Demasiados intentos. Intenta mas tarde' });
    }
    next();
}

function falloLogin(ip) {
    registro(ip).count++;
}

function loginCorrecto(ip) {
    intentosPorIp.delete(ip);
}

// Limpieza periodica para que el mapa no crezca sin limite
setInterval(() => {
    const ahora = Date.now();
    for (const [ip, r] of intentosPorIp) {
        if (ahora - r.desde > VENTANA) intentosPorIp.delete(ip);
    }
}, VENTANA).unref();

module.exports = { rateLimitLogin, falloLogin, loginCorrecto, MAX_INTENTOS };
