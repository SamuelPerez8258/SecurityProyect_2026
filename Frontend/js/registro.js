
import { api } from './api.js';
import { guardarSesion, sesionAlmacenada } from './sesion.js';

if (sesionAlmacenada()) location.replace('index.html');

const CONTRASENAS_COMUNES = ['123456', '12345678', 'password', 'contrase', '111111', 'pokeball'];

const campos = {
  nombre: document.getElementById('campo-nombre'),
  email: document.getElementById('campo-correo'),
  pw: document.getElementById('campo-clave'),
  confirm: document.getElementById('campo-confirmar')
};

const entradas = {
  nombre: document.getElementById('regNombre'),
  correo: document.getElementById('regCorreo'),
  clave: document.getElementById('regPw'),
  confirmar: document.getElementById('regPw2')
};

const mensaje = document.getElementById('mensaje');
const boton = document.getElementById('registroBtn');
const original = mensaje.textContent.trim();

/** clave de la caja -> su input, porque los ids no calcan los nombres del estado. */
const INPUTS = {
  nombre: entradas.nombre,
  email: entradas.correo,
  pw: entradas.clave,
  confirm: entradas.confirmar
};

/* el error se limpia al escribir, como hacía setMalo({...m, campo:false}) */
Object.entries(campos).forEach(([k, caja]) => {
  INPUTS[k].addEventListener('input', () => {
    caja.classList.remove('err');
    INPUTS[k].setAttribute('aria-invalid', 'false');
  });
});

function marcar(clave, activo) {
  campos[clave].classList.toggle('err', !!activo);
  INPUTS[clave].setAttribute('aria-invalid', activo ? 'true' : 'false');
}

function decir(texto, esError) {
  mensaje.textContent = texto || original;
  mensaje.className = 'msg' + (esError ? ' err' : '');
}

function validar() {
  const textos = [];
  const mail = entradas.correo.value.trim();
  const clave = entradas.clave.value;

  Object.keys(campos).forEach(k => marcar(k, false));

  if (entradas.nombre.value.trim().length < 3) {
    marcar('nombre', true); textos.push('Elige un usuario de al menos 3 caracteres.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(mail)) {
    marcar('email', true);
    textos.push(mail ? 'El correo no tiene un formato válido.' : 'Escribe un correo para contactarte.');
  }
  if (clave.length < 8) {
    marcar('pw', true); textos.push('La contraseña debe tener al menos 8 caracteres.');
  } else if (CONTRASENAS_COMUNES.includes(clave.toLowerCase())) {
    marcar('pw', true); textos.push('Esa contraseña es demasiado común; usa una distinta.');
  }
  if (!entradas.confirmar.value || entradas.confirmar.value !== clave) {
    marcar('confirm', true); textos.push('La confirmación no coincide con la contraseña.');
  }

  return textos[0] || '';
}

document.getElementById('registroForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const primerError = validar();
  if (primerError) {
    decir(primerError, true);
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Creando tu cuenta…';
  try {
    guardarSesion(await api.registrarse({
      nombre: entradas.nombre.value.trim(),
            email: entradas.correo.value.trim().toLowerCase(),
      password: entradas.clave.value,
      rol: document.querySelector('input[name="rol"]:checked')?.value || 'comprador'
    }));
    location.replace('index.html');
  } catch (err) {
    decir(err && err.message ? err.message : 'No pudimos crear tu cuenta.', true);
    boton.disabled = false;
    boton.textContent = 'Crear cuenta';
  }
});

