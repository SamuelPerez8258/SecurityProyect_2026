require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');


if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32){
    console.error('Falta la variable de entorno JWT_SECRET');
    process.exit(1);
}

const app = express();

app.set('trust proxy', 1);

const ORIGENES = (process.env.FRONTEND_ORIGIN || '')
    .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
    origin: ORIGENES.length ? ORIGENES : true,
    credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/sesion'));
app.use('/productos', require('./routes/productos'));
app.use('/archivos', require('./routes/archivos'));
app.use('/usuarios', require('./routes/usuarios'));
app.use('/facturas', require('./routes/facturas'));

app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(err.status || 500).json({ message: 'Solicitud inválida' });
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running on port ' + (process.env.PORT || 3000));
})