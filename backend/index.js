require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');


if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('Falta la variable de entorno JWT_SECRET');
    process.exit(1);
}

const app = express();

// No anunciar que el backend es Express
app.disable('x-powered-by');
// Solo se confia en el proxy local (Nginx) para la IP real del cliente
app.set('trust proxy', 'loopback');

app.use(cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true
}));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/productos'));
app.use('/', require('./routes/archivos'));
app.use('/', require('./routes/usuarios'));
app.use('/', require('./routes/facturas'));

// Rutas que no existen: respuesta generica, sin la pagina por defecto de Express
app.use((req, res) => {
    res.status(404).json({ message: 'No encontrado' });
});

app.use((err, req, res, next) => {
    res.status(err.status && err.status < 500 ? err.status : 500).json({ message: 'Solicitud invalida' });
});

// Por defecto solo escucha en localhost: desde fuera unicamente se entra por Nginx
const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3000;
app.listen(PORT, HOST, () => {
    console.log(`Server is running on ${HOST}:${PORT}`);
});
