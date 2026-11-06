const MAX_INTENTOS = 5;

const intentosPorIp = new Map();
function rateLimitLogin(req, res, next) {
    const ahora = Date.now();
    const registro = intentosPorIp.get(req.ip) ?? { count:0, desde: ahora };

    if(ahora - registro.desde > 15 * 60 * 1000){
        registro.count = 0;  
        registro.desde = ahora;  
    }

    registro.count++;
    intentosPorIp.set(req.ip, registro);

    if(registro.count > MAX_INTENTOS){
        return res.status(429).json({ message: `Demasiados intentos. Intenta mas tarde` });
    }

    next();
}

module.exports = { rateLimitLogin, MAX_INTENTOS };