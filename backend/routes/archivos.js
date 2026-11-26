const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { requireAuth, requireRole } = require('../middleware/auth');

// Las fotos se guardan dentro de Frontend/uploads para que Nginx las sirva
// directo como /uploads/<archivo>
const CARPETA = path.join(__dirname, '..', '..', 'Frontend', 'uploads');
fs.mkdirSync(CARPETA, { recursive: true });

const EXTENSIONES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/avif': '.avif'
};

// El Content-Type lo manda el cliente y se puede falsificar: se revisa la firma
// real del archivo (magic bytes) antes de aceptarlo.
const FIRMAS = {
  '.png': b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.webp': b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  '.avif': b => b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp' && /^avi[fs]/.test(b.toString('ascii', 8, 12))
};

const subir = multer({
  storage: multer.diskStorage({
    destination: CARPETA,
    filename: (req, file, cb) => {
      cb(null, crypto.randomBytes(12).toString('hex') + EXTENSIONES[file.mimetype]);
    }
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXTENSIONES[file.mimetype]))
}).single('archivo');

// Maximo de subidas por usuario en una ventana de tiempo (evita llenar el disco)
const VENTANA = 10 * 60 * 1000;
const MAX_SUBIDAS = 20;
const subidas = new Map();
function limiteSubidas(req, res, next) {
  const ahora = Date.now();
  const r = subidas.get(req.user.sub) ?? { n: 0, desde: ahora };
  if (ahora - r.desde > VENTANA) { r.n = 0; r.desde = ahora; }
  r.n++;
  subidas.set(req.user.sub, r);
  if (r.n > MAX_SUBIDAS) return res.status(429).json({ message: 'Demasiadas fotos seguidas. Intenta en unos minutos.' });
  next();
}

function firmaValida(ruta) {
  const fd = fs.openSync(ruta, 'r');
  try {
    const b = Buffer.alloc(16);
    const n = fs.readSync(fd, b, 0, 16, 0);
    const revisar = FIRMAS[path.extname(ruta)];
    return Boolean(revisar && revisar(b.subarray(0, n)));
  } finally {
    fs.closeSync(fd);
  }
}

// POST /archivos  requiere sesion. Recibe la foto en el campo "archivo" y
// devuelve la URL publica que el frontend guarda en el producto.
router.post('/archivos', requireAuth, requireRole(), limiteSubidas, (req, res) => {
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

    if (!firmaValida(req.file.path)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: 'El archivo no es una imagen valida.' });
    }

    res.status(201).json({ url: '/uploads/' + req.file.filename });
  });
});

module.exports = router;
