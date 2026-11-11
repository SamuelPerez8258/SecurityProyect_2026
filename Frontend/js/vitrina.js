/**
 * Vitrina: anillo 3D de las piezas de la tienda + rail de espera + ficha de
 * detalle. Es la traducción literal de components/Vitrina.tsx: mismas curvas
 * (KX/KF/KH/KB/KO), mismo muelle exponencial y mismo trato del puntero, solo
 * que en vez de refs de React seConsultan los nodos que generamos arriba.
 */
import { cartaHtml, montarFicha, railCardHtml } from './carta.js';
import { agregarAlCarrito } from './carrito.js';

const KX = [1.2, 0.744, 0.496, 0.346, 0.235, 0.15, 0.085];
const KF = [1.14, 0.89, 0.777, 0.704, 0.651, 0.616, 0.59];
const KH = [1.18, 0.832, 0.574, 0.436, 0.334, 0.258, 0.19];
const KB = [0, 0, 1.5, 4, 8, 12, 17];
const KO = [1, 1, 1, 1, 0.86, 0.5, 0];
const R = 0.7;

/* El frente del abanico siempre cae en el índice 1: k = d+1 nunca baja de 1. */
const FRENTE = 1;
/* Respiración que se deja en los bordes del escenario al encoger el abanico. */
const MARGEN = 0.01;
/* Índice de la última carta que aún se ve (KO[6] = 0), el resto no cuenta. */
const ULTIMO = 5;

const aprieta = (x, a, b) => Math.min(b, Math.max(a, x));
const envuelve = (x, n) => ((x % n) + n) % n;

const CUERPO = productos => `<div class="runway-grid">
  <section class="stage" aria-label="Estantería 3D de cartas TCG" tabindex="0" id="escenario">
    <div class="stage-pista" id="pista">${productos.map(p => cartaHtml(p)).join('')}</div>
    <div class="intro">
      <h2 class="font-title">Colección Pokémon GO</h2>
      <p>Un recorrido inmersivo en 3D por las piezas más exclusivas. Toca una carta para ver precio, stock, certificadora y grado.</p>
    </div>
    <div class="tag">
      <div class="look font-title" aria-live="polite">
        <span>Pieza</span>
        <span class="win"><span class="roll" id="rotulos">${Array.from({ length: Math.max(1, productos.length) + 1 }, (_, i) => `<b>${i + 1}</b>`).join('')}</span></span>
      </div>
      <div class="dots" id="pil" aria-hidden="true"></div>
      <button class="shop-btn font-title" type="button" id="anadir-frontal">Añadir a Pokédex</button>
      <p class="hint">Desliza para cambiar de pieza</p>
    </div>
    <div class="ring" id="anillo" aria-hidden="true"></div>
  </section>
  <p class="rail-title">Todas las piezas</p>
  <aside class="rail" id="rail" aria-label="Piezas de la vitrina">${productos.map((p, i) => railCardHtml(p, i)).join('')}</aside>
</div>`;

/**
 * Monta la vitrina dentro de `<section class="runway">`. Devuelve false si no
 * hay catálogo, para que la página pinte su propio aviso.
 */
export function montarVitrina({ ancla, productos, aviso }) {
  const n = productos.length;
  if (!n) return false;

  ancla.innerHTML = CUERPO(productos);

  const stage = ancla.querySelector('#escenario');
  const line = ancla.querySelector('#pista');
  const ring = ancla.querySelector('#anillo');
  const rail = ancla.querySelector('#rail');
  const roll = ancla.querySelector('#rotulos');
  const pil = ancla.querySelector('#pil');
  const rotulo = ancla.querySelector('.rail-title');

  const m = {
    W: 0, H: 0, base: 0, cardS: 0, paso: 0, fit: 1, lado: false, sucio: true,
    pos: 0, destino: 0, previo: 0, mx: 0, my: 0, cx: 0, cy: 0,
    abajo: false, x0: 0, t0: 0, movido: 0, visible: true
  };

  const nodos = Array.from(line.querySelectorAll('.m'));
  const piezas = Array.from(rail.querySelectorAll('.card'));
  const difuso = nodos.map(() => '');
  const opaco = nodos.map(() => '');
  if (pil) pil.innerHTML = productos.map(() => '<i></i>').join('');
  let punto = -1;
  const orden = productos.map((_, i) => i);
  const M = orden.length;

  nodos.forEach((el, i) => { el.dataset.i = String(i); });

  let fichaAbierta = false;

  const frontal = () => productos[aprieta(Math.round(envuelve(m.destino, n)), 0, n - 1)] ?? null;

  const anadir = p => { if (p) aviso(agregarAlCarrito(p).mensaje); };

  const abrirFicha = p => {
    fichaAbierta = true;
    montarFicha({ ancla, producto: p, aviso, canal: aviso, alCerrar: () => { fichaAbierta = false; } });
  };

  const TIRON = () => Math.max(150, m.W * 0.2);
  const quieta = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* En escritorio el frente cae al 74% del ancho, pegado al rail lateral. En móvil
   * el rail bajó de columna, así que el frente se centra o la carta se va del cuadro. */
  const baseX = () => (m.lado ? 0.5 : KX[FRENTE]) * m.W;

  /* Hasta qué ranura del abanico se dibuja. Con el frente centrado, la tercera
   * vecina y las que vienen detrás ya no caben en el escenario: se apagaban a
   * medias y el borde de pantalla las cortaba, así que aquí se cortan de raíz. */
  const PROFUNDIDAD = () => (m.lado ? 3 : ULTIMO);

  /* Caja del abanico medida desde el centro de la carta frontal: si no cabe en el
   * escenario se encogen tamaños y separaciones por igual alrededor de ella.
   * En móvil el frente se centró (baseX), así que la caja también se mide desde
   * ese centro; antes se medía desde KX[FRENTE] y las vecinas se salían del
   * cuadro: el borde de pantalla las cortaba por la mitad. */
  const cabida = () => {
    const frente = baseX();
    const fondo = PROFUNDIDAD();
    let der = 1, izq = 1;
    for (let k = FRENTE; k <= fondo; k++) {
      const medio = KH[k] * m.H * R / 2;
      const hueco = (KX[k] - KX[FRENTE]) * m.W;
      der = Math.max(der, hueco + medio);
      izq = Math.max(izq, medio - hueco);
    }
    return aprieta(Math.min((m.W * (1 - MARGEN) - frente) / der, (frente - m.W * MARGEN) / izq), 0.3, 1);
  };

  const tamano = () => {
    /* El abanico vive en la pista, no en el escenario: en escritorio miden igual,
     * pero en móvil el escenario además lleva debajo el rótulo y el botón. */
    m.W = line.clientWidth;
    m.H = line.clientHeight;
    /* La columna no empieza en 820 sino en 1024: en la ventana de portátil
     * pequeña el grid de escritorio deja el rail en ~180 px y el abanico se
     * monta sobre el rótulo. Debe coincidir con la banda CSS 821–1024. */
    m.lado = window.innerWidth <= 1024;
    m.fit = cabida();
    m.base = m.H * 1.2 * m.fit;
    nodos.forEach(el => {
      el.style.width = m.base * R + 'px';
      el.style.height = m.base + 'px';
    });
    m.cardS = m.lado ? aprieta(Math.round(rail.clientWidth * 0.62), 188, 268)
                     : Math.round(rail.clientHeight / 3);
    /* Paso = lo que ocupa una tarjeta a lo largo del riel; cardS = la separación
     * entre ranuras. En móvil son distintos porque las tarjetas van holgadas. */
    m.paso = m.lado ? m.cardS - 12 : m.cardS;
    /* El riel va de borde a borde; el margen de la sección lo presta el rótulo,
     * que ya lo lleva en su margen lateral. */
    m.margen = m.lado && rotulo ? Math.round(rotulo.getBoundingClientRect().left) : 0;
    piezas.forEach(el => {
      el.style.width = m.lado ? m.paso + 'px' : '';
      el.style.height = m.lado ? '100%' : m.cardS + 'px';
    });
    m.sucio = true;
    despierta();
  };

  const pinta = () => {
    nodos.forEach((el, mi) => {
      const pos = orden.indexOf(mi);
      if (pos < 0) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        return;
      }
      let d = envuelve(pos - m.pos, M);
      if (d > M - 1) d -= M;
      /* Más allá de la profundidad del móvil no se pintan: ver nota en PROFUNDIDAD. */
      const k = aprieta(d + 1, 0, 6);
      if (k > PROFUNDIDAD()) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        return;
      }
      const a = Math.floor(k);
      const b = Math.min(6, a + 1);
      const t = k - a;
      const mezcla = A => A[a] + (A[b] - A[a]) * t;

      const h = mezcla(KH) * m.H * m.fit;
      const s = h / m.base;
      const w = h * R;
      const x = baseX() + (mezcla(KX) * m.W - KX[FRENTE] * m.W) * m.fit - w / 2;
      const y = mezcla(KF) * m.H - h;

      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${s.toFixed(4)})`;
      /* El desenfoque se aplica en el espacio local de la carta, así que hay que
       * agrandarlo por s para que salga como KB px en pantalla. Esos KB px son los
       * que se ven en el escritorio; cuando el escenario encoge, se escalan igual
       * que la carta o el vecino se vuelve una mancha. */
      const escala = aprieta((m.H * m.fit) / 800, 0.22, 1);
      const f = (mezcla(KB) * escala) / s;
      const fijo = f < 0.2 ? 'none' : `blur(${f.toFixed(1)}px)`;
      /* En móvil las vecinas bajan al 42 %: se insínúan sin desenfoque pesado.
       * La curva KO las deja opacas porque en escritorio hay que leerlas. */
      const op = m.lado && d >= 0.5 ? (mezcla(KO) * 0.42).toFixed(3) : mezcla(KO).toFixed(3);
      if (fijo !== difuso[mi]) { difuso[mi] = fijo; el.style.filter = fijo; }
      if (op !== opaco[mi]) { opaco[mi] = op; el.style.opacity = op; }
      el.style.zIndex = String(100 - Math.round(d * 10));
      el.style.pointerEvents = d <= 5 ? 'auto' : 'none';
    });

    const frente = aprieta(Math.round(envuelve(m.pos, M)), 0, M - 1);
    const carril = m.lado ? rail.clientWidth : rail.clientHeight;
    /* Dejó de ser columna lateral: la pieza activa se alinea con el margen del
     * rótulo y la siguiente asoma por la derecha. Centrarla dejaba recortes a
     * ambos lados, que parecían una tarjeta mal cortada. */
    const inicio = m.lado ? m.margen : carril / 2 - m.paso / 2;
    piezas.forEach((el, i) => {
      const y = inicio + (i - frente) * m.cardS;
      el.classList.toggle('activo', i === frente);
      el.style.transform = m.lado
        ? `translate3d(${y.toFixed(1)}px,0,0)`
        : `translate3d(0,${y.toFixed(1)}px,0)`;
    });

    if (pil && frente !== punto) {
      punto = frente;
      Array.from(pil.children).forEach((d, i) => d.classList.toggle('on', i === frente));
    }

    const primera = roll.firstElementChild;
    if (primera) {
      roll.style.transform = `translate3d(0,${(-envuelve(m.pos, M) * primera.offsetHeight).toFixed(1)}px,0)`;
    }
  };

  const paso = now => {
    const dt = Math.min(50, now - m.previo) || 16;
    m.previo = now;
    const antes = m.pos;

    if (quieta) m.pos = m.destino;
    else m.pos += (m.destino - m.pos) * (1 - Math.exp(-dt * 0.0072));

    if (Math.abs(m.destino - m.pos) < 0.0004) m.pos = m.destino;
    if (m.pos !== antes || m.sucio) {
      m.sucio = false;
      pinta();
    }

    /* El aro sólo existe en escritorio: en tablet está en display:none, así que
     * no merece ni un frame de seguimiento. */
    if (!m.lado) {
      m.cx += (m.mx - m.cx) * 0.32;
      m.cy += (m.my - m.cy) * 0.32;
      ring.style.transform = `translate3d(${m.cx.toFixed(1)}px,${m.cy.toFixed(1)}px,0)`;
    }
  };

  /* Queda algo por mover: el abanico, el aro o una redibujada pendiente. */
  const enMovimiento = () => m.sucio || m.abajo
    || Math.abs(m.destino - m.pos) > 0.0004
    || (!m.lado && (Math.abs(m.mx - m.cx) > 0.4 || Math.abs(m.my - m.cy) > 0.4));

  /* El bucle se para solo cuando ya nada se mueve. Corriendo de forma
   * perpetua pintaba en reposo y el arrastre respondía a tirones en tablet. */
  let corriendo = false;
  const bucle = t => {
    paso(t);
    if (enMovimiento()) requestAnimationFrame(bucle);
    else corriendo = false;
  };
  const despierta = () => {
    if (corriendo) return;
    corriendo = true;
    requestAnimationFrame(bucle);
  };

  const entra = e => { if (e.pointerType === 'mouse') ring.classList.add('show'); };
  const sale = () => ring.classList.remove('show');

  const mueve = e => {
    const r = stage.getBoundingClientRect();
    m.mx = e.clientX - r.left;
    m.my = e.clientY - r.top;
    despierta();
    if (!m.abajo) {
      const encima = document
        .elementsFromPoint(e.clientX, e.clientY)
        .some(x => x.classList && x.classList.contains('m'));
      ring.classList.toggle('pick', encima);
      return;
    }
    const dx = e.clientX - m.x0;
    m.movido = Math.max(m.movido, Math.abs(dx));
    m.destino = m.t0 + dx / TIRON();
  };

  const baja = e => {
    if (e.target.closest('button')) return;
    m.abajo = true;
    m.x0 = e.clientX;
    m.t0 = m.destino;
    m.movido = 0;
    stage.setPointerCapture(e.pointerId);
    ring.classList.add('drag');
    despierta();
  };

  const suelta = e => {
    if (!m.abajo) return;
    m.abajo = false;
    ring.classList.remove('drag');
    const golpe = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find(x => x.classList && x.classList.contains('m'));

    if (m.movido < 6) {
      if (golpe) {
        const i = Number(golpe.dataset.i);
        if (Number.isFinite(i)) {
          let d = envuelve(orden.indexOf(i) - m.destino, M);
          d = Math.round(d);
          if (d > 0 && d < M) m.destino = Math.round(m.destino) + d;
          abrirFicha(productos[i]);
        }
      }
    } else {
      m.destino = Math.round(m.destino);
    }
    despierta();
  };

  let rueda = 0;
  const rode = e => {
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
    if (!dx) return;
    e.preventDefault();
    m.destino += aprieta(dx, -120, 120) / 420;
    despierta();
    clearTimeout(rueda);
    rueda = window.setTimeout(() => { m.destino = Math.round(m.destino); despierta(); }, 150);
  };

  const teclas = e => {
    if (fichaAbierta) return;
    if (!m.visible || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      m.destino = aprieta(Math.round(m.destino) + 1, 0, M - 1);
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      m.destino = aprieta(Math.round(m.destino) - 1, 0, M - 1);
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') despierta();
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === stage) {
      e.preventDefault();
      abrirFicha(productos[orden[aprieta(Math.round(envuelve(m.destino, M)), 0, M - 1)] ?? 0]);
    }
  };

  rail.addEventListener('click', e => {
    const corazon = e.target.closest('.fav');
    if (corazon) {
      corazon.setAttribute('aria-pressed', String(corazon.getAttribute('aria-pressed') !== 'true'));
      return;
    }
    const tarjeta = e.target.closest('.card');
    if (!tarjeta) return;
    const p = productos[Number(tarjeta.dataset.i)];
    if (!p) return;
    if (e.target.closest('.add')) {
      anadir(p);
      return;
    }
    m.destino = Number(tarjeta.dataset.i);
    despierta();
    abrirFicha(p);
  });

  ancla.querySelector('#anadir-frontal').addEventListener('click', () => anadir(frontal()));

  const observador = new IntersectionObserver(en => { m.visible = en[0].isIntersecting; }, { threshold: 0.3 });
  const medidor = new ResizeObserver(() => tamano());

  stage.addEventListener('pointerenter', entra);
  stage.addEventListener('pointerleave', sale);
  stage.addEventListener('pointermove', mueve);
  stage.addEventListener('pointerdown', baja);
  stage.addEventListener('pointerup', suelta);
  stage.addEventListener('pointercancel', suelta);
  stage.addEventListener('wheel', rode, { passive: false });
  window.addEventListener('resize', tamano);
  window.addEventListener('keydown', teclas);
  observador.observe(stage);
  medidor.observe(stage);
  medidor.observe(line);
  medidor.observe(rail);

  tamano();
  pinta();
  despierta();
  if (document.fonts) {
    document.fonts.ready.then(() => { tamano(); pinta(); });
  }
  return true;
}
