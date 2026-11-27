const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { requireAuth, requireRole } = require('../middleware/auth');


const CARPETA = path.join(__dirname, '..', '..', 'Frontend', 'uploads');
fs.mkdirSync(CARPETA, { recursive: true });

const EXTENSIONES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/avif': '.avif'
};

const subir = multer({
  storage: multer.diskStorage({
    destination: CARPETA,
    filename: (req, file, cb) => {
      cb(null, crypto.randomBytes(12).toString('hex') + EXTENSIONES[file.mimetype]);
    }
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXTENSIONES[file.mimetype]))
}).single('archivo');


router.post('/archivos', requireAuth, requireRole(), (req, res) => {
  subir(req, res, err => {
    if (err) {
      const mensaje = err.code === 'LIMIT_FILE_SIZE'
        ? 'La foto pesa demasiado: maximo 6 MB'
        : 'No se pudo subir la foto';
      return res.status(400).json({ message: mensaje });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Sube una imagen PNG, JPG, WEBP o AVIF' });
    }

    res.status(201).json({ url: '/uploads/' + req.file.filename });
  });
});

module.exports = router;