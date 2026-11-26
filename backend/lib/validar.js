// Validacion de entradas compartida por todas las rutas.
// Regla general: ningun texto que guarde el backend puede traer < > (evita HTML
// y XSS almacenado). Los campos que el frontend pinta dentro de atributos
// tampoco aceptan comillas dobles ni acento grave.

class ErrorValidacion extends Error {
  constructor(message) {
    super(message);
    this.http = 400;
  }
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PELIGROSO_ATRIBUTO = /[<>"`]/;
const PELIGROSO_CONTENIDO = /[<>]/;

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const USUARIO = /^[A-Za-z0-9_]{3,30}$/;
const ID_NUM = /^[1-9]\d{0,9}$/;
const ID_PRODUCTO = /^[A-Za-z0-9-]{1,40}$/;
const FOLIO = /^PV-\d{4}-\d{4,10}$/;
const IMAGEN_SUBIDA = /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp|avif)$/;
const IMAGEN_CATALOGO = /^https:\/\/images\.pokemontcg\.io\/[A-Za-z0-9/_.-]{1,200}$/;

// Texto libre. opciones: { max, min, requerido, contenido }
// contenido = true -> se pinta solo como contenido HTML (permite comillas)
function texto(valor, nombre, { max = 120, min = 0, requerido = false, contenido = false } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ErrorValidacion(`${nombre} es obligatorio.`);
    return '';
  }
  if (typeof valor !== 'string' && typeof valor !== 'number') {
    throw new ErrorValidacion(`${nombre} no es valido.`);
  }
  const t = String(valor).trim();
  if (requerido && t.length === 0) throw new ErrorValidacion(`${nombre} es obligatorio.`);
  if (t.length < min || t.length > max) {
    throw new ErrorValidacion(`${nombre} debe tener entre ${min} y ${max} caracteres.`);
  }
  if (CONTROL.test(t) || (contenido ? PELIGROSO_CONTENIDO : PELIGROSO_ATRIBUTO).test(t)) {
    throw new ErrorValidacion(`${nombre} contiene caracteres no permitidos (< > " \`).`);
  }
  return t;
}

function email(valor) {
  const t = String(valor ?? '').trim().toLowerCase();
  if (t.length > 250 || !EMAIL.test(t)) throw new ErrorValidacion('El correo no es valido.');
  return t;
}

function usuario(valor) {
  if (typeof valor !== 'string' || !USUARIO.test(valor)) {
    throw new ErrorValidacion('El usuario debe tener de 3 a 30 letras, numeros o guion bajo, sin espacios.');
  }
  return valor;
}

function password(valor) {
  if (typeof valor !== 'string' || valor.length < 8 || valor.length > 128) {
    throw new ErrorValidacion('La contrasena debe tener entre 8 y 128 caracteres.');
  }
  return valor;
}

function numero(valor, nombre, { min = 0, max = 1e6, entero = false } = {}) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min || n > max || (entero && !Number.isInteger(n))) {
    throw new ErrorValidacion(`${nombre} debe ser un numero entre ${min} y ${max}.`);
  }
  return entero ? n : Math.round(n * 100) / 100;
}

function imagen(valor) {
  const t = String(valor ?? '').trim();
  if (!IMAGEN_SUBIDA.test(t) && !IMAGEN_CATALOGO.test(t)) {
    throw new ErrorValidacion('La imagen no es valida: sube la foto desde el formulario.');
  }
  return t;
}

const idNum = v => (ID_NUM.test(String(v)) ? Number(v) : null);
const idProducto = v => (ID_PRODUCTO.test(String(v)) ? String(v) : null);
const folio = v => (FOLIO.test(String(v)) ? String(v) : null);

module.exports = { ErrorValidacion, texto, email, usuario, password, numero, imagen, idNum, idProducto, folio };
