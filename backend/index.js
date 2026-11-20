require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');


if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32){
    console.error('Falta la variable de entorno JWT_SECRET');
    process.exit(1);
}

const app = express();

app.set('trust proxy', 1);

app.use(cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true
}));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/productos'));

app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: 'Solicitud invalida' });
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running on port ' + (process.env.PORT || 3000));
})