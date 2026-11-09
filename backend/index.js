require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');


if(!process.env.JWT_SECRET){
    console.error('Falta la variable de entorno JWT_SECRET');
    process.exit(1);
}

const app = express();

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.use('/', require('./routes/auth'));

app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: 'Solicitud inválida' });
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running on port ' + (process.env.PORT || 3000));
})