const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireRol } = require('../middleware/roles');

const carpeta = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(carpeta, { recursive: true });

// VULN: subida sin validar tipo, extension ni tamano; conserva el nombre original
const upload = multer({
    storage: multer.diskStorage({
        destination: carpeta,
        filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
    })
});

router.post('/', ...requireRol('vendedor', 'administrador'), upload.single('archivo'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No se recibio ningun archivo.' });
    res.status(201).json({
        url: `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(req.file.filename)}`
    });
});

module.exports = router;