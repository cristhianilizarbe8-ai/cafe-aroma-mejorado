/* =========================================================
   Café Aroma · script.js  (versión con Supabase)
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const cap = t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const soles = n => 'S/. ' + (Math.round(Number(n) * 100) / 100).toString();
// Escapa texto que viene de la base de datos antes de ponerlo en el HTML (evita inyección de código)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Fotografías locales de respaldo: se muestran aunque la URL guardada en Supabase no cargue.
const fotosLocales = {
  capuchino: 'img/capuchino.jpg', cappuccino: 'img/capuchino.jpg',
  espresso: 'img/espresso.jpg', americano: 'img/americano.jpg',
  ristretto: 'img/ristretto.jpg', latte: 'img/latte.jpg',
  mocha: 'img/mocha.jpg', mocca: 'img/mocha.jpg'
};
function fotoLocal(nombre = '') {
  const clave = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return fotosLocales[clave] || 'img/hero-cafe.jpg';
}
function htmlFotoProducto(producto) {
  const respaldo = fotoLocal(producto.nombre);
  const principal = producto.imagen_url || respaldo;
  return `<img src="${esc(principal)}" data-respaldo="${respaldo}" alt="${esc(producto.nombre)}" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.respaldo">`;
}

// ---------- Conexión a Supabase ----------
const CFG = window.CAFE_CONFIG || {};
const configurado = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
  !CFG.SUPABASE_URL.includes('TU-PROYECTO') && !CFG.SUPABASE_ANON_KEY.includes('TU_ANON') && window.supabase);
const sb = configurado ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
if (!configurado) $('#aviso-config').hidden = false;

// Traduce los errores de Supabase a mensajes claros
function msgError(err) {
  const m = (err && err.message) || String(err || '');
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/already registered|already been registered/i.test(m)) return 'Ese correo ya está registrado. Inicia sesión.';
  if (/email not confirmed/i.test(m)) return 'Confirma tu correo antes de iniciar sesión (revisa tu bandeja).';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
  if (/password should be at least/i.test(m)) return 'La contraseña es demasiado corta.';
  if (/failed to fetch|network/i.test(m)) return 'No hay conexión con el servidor. Revisa tu internet.';
  if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para hacer esto.';
  return m || 'Ocurrió un error. Inténtalo de nuevo.';
}

// ---------- Estado ----------
let usuario = null;          // usuario de Supabase Auth
let perfil = null;           // fila de la tabla profiles
let categorias = [];
let productos = [];
let favoritos = new Set();   // ids de productos favoritos
let filtro = 'todos', consulta = '';
let irAPagoTrasLogin = false;
let carrito = [];            // [{id, cant}]
try { carrito = JSON.parse(localStorage.getItem('cafearoma_carrito') || '[]'); } catch { carrito = []; }
const guardarCarrito = () => { try { localStorage.setItem('cafearoma_carrito', JSON.stringify(carrito)); } catch {} };

// ---------- Avisos (toast) ----------
let tToast;
function aviso(txt) {
  const t = $('#toast');
  t.textContent = txt; t.classList.add('ver');
  clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove('ver'), 2800);
}

// ---------- Navbar ----------
const nav = $('#nav');
const onScroll = () => nav.classList.toggle('solido', scrollY > 30);
addEventListener('scroll', onScroll, { passive: true }); onScroll();
$('#btn-menu').addEventListener('click', () => $('#enlaces').classList.toggle('abierto'));
$$('#enlaces a').forEach(a => a.addEventListener('click', () => $('#enlaces').classList.remove('abierto')));

// ---------- Granos flotando en el hero ----------
(() => {
  const c = $('.granos');
  for (let i = 0; i < 14; i++) {
    const g = document.createElement('i'); g.className = 'grano';
    const s = 14 + Math.random() * 26;
    g.style.cssText = `width:${s}px;height:${s * 1.35}px;left:${Math.random() * 96}%;top:${Math.random() * 96}%;--r:${Math.random() * 360}deg;` +
      `animation-delay:${-Math.random() * 9}s;animation-duration:${7 + Math.random() * 6}s`;
    c.appendChild(g);
  }
})();

// =====================================================================
//  CATÁLOGO (desde la base de datos)
// =====================================================================
async function cargarCatalogo() {
  const grilla = $('#grilla');
  if (!sb) { grilla.innerHTML = '<p class="estado-grilla">Configura Supabase en <b>config.js</b> para ver el catálogo.</p>'; return; }
  grilla.innerHTML = '<p class="estado-grilla">Cargando carta…</p>';
  const [c, p] = await Promise.all([
    sb.from('categorias').select('id,nombre').order('nombre'),
    sb.from('productos').select('id,nombre,descripcion,precio,categoria_id,imagen_url,nuevo').eq('activo', true).order('id'),
  ]);
  if (c.error || p.error) {
    grilla.innerHTML = `<p class="estado-grilla">No se pudo cargar la carta.<br><small>${esc(msgError(c.error || p.error))}</small><br>
      <button class="btn" id="reintentar">Reintentar</button></p>`;
    $('#reintentar').addEventListener('click', cargarCatalogo);
    return;
  }
  categorias = c.data; productos = p.data;
  $('#filtros').innerHTML = `<button class="${filtro === 'todos' ? 'on' : ''}" data-cat="todos">Todos</button>` +
    categorias.map(x => `<button class="${filtro == x.id ? 'on' : ''}" data-cat="${x.id}">${esc(x.nombre)}</button>`).join('');
  dibujarCatalogo(); dibujarCarrito();
}

function dibujarCatalogo() {
  const q = consulta.toLowerCase();
  const lista = productos.filter(p => (filtro === 'todos' || p.categoria_id == filtro) && p.nombre.toLowerCase().includes(q));
  $('#grilla').innerHTML = lista.map((p, i) => `
    <article class="item" style="animation-delay:${i * .07}s">
      ${p.nuevo ? '<span class="nuevo">Nuevo</span>' : ''}
      <button class="fav ${favoritos.has(p.id) ? 'on' : ''}" data-fav="${p.id}" aria-label="Favorito"><svg><use href="#i-heart"/></svg></button>
      <div class="foto">${htmlFotoProducto(p)}</div>
      <h3>${esc(p.nombre)}</h3>
      <p class="desc">${esc(p.descripcion)}</p>
      <div class="pie-item"><span class="precio">${soles(p.precio)}</span>
        <button class="mas" data-add="${p.id}" aria-label="Añadir ${esc(p.nombre)}"><svg><use href="#i-plus"/></svg><span>Añadir</span></button></div>
    </article>`).join('') || '<p class="vacio">No encontramos resultados 😕</p>';
}
$('#filtros').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#filtros button').forEach(x => x.classList.toggle('on', x === b));
  filtro = b.dataset.cat; dibujarCatalogo();
});
$('#buscar').addEventListener('input', e => { consulta = e.target.value.trim(); dibujarCatalogo(); });
$('#grilla').addEventListener('click', e => {
  const a = e.target.closest('[data-add]'); if (a) return agregar(+a.dataset.add);
  const f = e.target.closest('[data-fav]'); if (f) return alternarFavorito(+f.dataset.fav);
});

// =====================================================================
//  FAVORITOS
// =====================================================================
async function cargarFavoritos() {
  favoritos = new Set();
  if (!sb || !usuario) return dibujarCatalogo();
  const { data } = await sb.from('favoritos').select('producto_id').eq('usuario_id', usuario.id);
  favoritos = new Set((data || []).map(x => x.producto_id));
  dibujarCatalogo();
}
async function alternarFavorito(id) {
  if (!usuario) { aviso('Inicia sesión para guardar favoritos'); return abrirModal('login'); }
  const era = favoritos.has(id);
  era ? favoritos.delete(id) : favoritos.add(id);           // se actualiza al instante
  $$(`[data-fav="${id}"]`).forEach(b => b.classList.toggle('on', !era));
  const { error } = era
    ? await sb.from('favoritos').delete().eq('usuario_id', usuario.id).eq('producto_id', id)
    : await sb.from('favoritos').insert({ usuario_id: usuario.id, producto_id: id });
  if (error) {                                               // si falla, se revierte
    era ? favoritos.add(id) : favoritos.delete(id);
    $$(`[data-fav="${id}"]`).forEach(b => b.classList.toggle('on', era));
    aviso(msgError(error));
  } else aviso(era ? 'Quitado de favoritos' : 'Añadido a favoritos ♥');
}

// =====================================================================
//  CARRITO (se guarda en el navegador)
// =====================================================================
const prod = id => productos.find(p => p.id === id);
function agregar(id, n = 1, silencioso = false) {
  const p = prod(id); if (!p) return;
  const l = carrito.find(x => x.id === id);
  l ? l.cant = Math.min(50, l.cant + n) : carrito.push({ id, cant: n });
  guardarCarrito(); dibujarCarrito();
  if (!silencioso) aviso(`${p.nombre} añadido al carrito`);
}
const lineasCarrito = () => carrito.filter(l => prod(l.id));
const totalCarrito = () => lineasCarrito().reduce((s, l) => s + l.cant * prod(l.id).precio, 0);
function dibujarCarrito() {
  if (productos.length) { carrito = lineasCarrito(); guardarCarrito(); }  // quita productos que ya no existen
  const n = carrito.reduce((s, l) => s + l.cant, 0);
  const b = $('#cuenta'); b.textContent = n; b.classList.toggle('ver', n > 0);
  $('#total').textContent = soles(totalCarrito());
  $('#lista-carrito').innerHTML = carrito.length ? carrito.map(l => {
    const p = prod(l.id); if (!p) return '';
    return `<div class="lin">
      <div class="mini"><svg><use href="#taza"/></svg>${p.imagen_url ? `<img src="${esc(p.imagen_url)}" alt="" onerror="this.remove()">` : ''}</div>
      <div><b>${esc(p.nombre)}</b><small>${soles(p.precio * l.cant)}</small>
        <div class="cant"><button data-menos="${p.id}" aria-label="Menos"><svg><use href="#i-minus"/></svg></button><span>${l.cant}</span>
          <button data-mas="${p.id}" aria-label="Más"><svg><use href="#i-plus"/></svg></button></div></div>
      <button class="quitar" data-quitar="${p.id}" aria-label="Quitar"><svg><use href="#i-trash"/></svg></button></div>`;
  }).join('') : '<div class="vacio-c"><svg><use href="#i-cart"/></svg><p>Tu carrito está vacío.<br>¡Agrega tu primer café!</p></div>';
}
$('#lista-carrito').addEventListener('click', e => {
  const m = e.target.closest('[data-mas]'), r = e.target.closest('[data-menos]'), q = e.target.closest('[data-quitar]');
  if (m) { const l = carrito.find(x => x.id == m.dataset.mas); l.cant = Math.min(50, l.cant + 1); }
  if (r) { const l = carrito.find(x => x.id == r.dataset.menos); if (--l.cant <= 0) carrito = carrito.filter(x => x !== l); }
  if (q) carrito = carrito.filter(x => x.id != q.dataset.quitar);
  guardarCarrito(); dibujarCarrito();
});
const abrirCarrito = v => { $('#panel').classList.toggle('ver', v); $('#velo').classList.toggle('ver', v); };
$('#btn-carrito').addEventListener('click', () => abrirCarrito(true));
$('#cerrar-carrito').addEventListener('click', () => abrirCarrito(false));
$('#velo').addEventListener('click', () => abrirCarrito(false));
$('#btn-pagar').addEventListener('click', () => {
  if (!lineasCarrito().length) return aviso('Agrega un producto primero');
  abrirCarrito(false);
  if (!usuario) { irAPagoTrasLogin = true; aviso('Inicia sesión para pagar'); return abrirModal('login'); }
  abrirVista('pago');
});

// =====================================================================
//  LOGIN / REGISTRO (Supabase Auth)
// =====================================================================
const modal = $('#modal');
function abrirModal(modo = 'login') {
  cambiarModo(modo);
  modal.classList.add('ver'); modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => $(modo === 'login' ? '#login-email' : '#reg-nombre').focus(), 350);
}
function cerrarModal() { modal.classList.remove('ver'); modal.setAttribute('aria-hidden', 'true'); }
function cambiarModo(modo) {
  const login = modo === 'login';
  $('#form-login').hidden = !login; $('#form-registro').hidden = login;
  $('#tabs').dataset.pos = login ? 0 : 1;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.auth === modo));
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-auth]'); if (!a) return;
  e.preventDefault();
  $('#enlaces').classList.remove('abierto');
  modal.classList.contains('ver') ? cambiarModo(a.dataset.auth) : abrirModal(a.dataset.auth);
});
$('#cerrar-modal').addEventListener('click', cerrarModal);
modal.addEventListener('click', e => { if (e.target === modal) cerrarModal(); });

$$('.ojo').forEach(b => b.addEventListener('click', () => {
  const i = b.parentElement.querySelector('input'); const ver = i.type === 'password';
  i.type = ver ? 'text' : 'password'; b.classList.toggle('ver', ver);
}));
$('#reg-pass').addEventListener('input', e => {
  const v = e.target.value; let n = 0;
  if (v.length >= 6) n++; if (v.length >= 8 && /[A-Z]/.test(v) && /\d/.test(v)) n++; if (v.length >= 10 && /[^A-Za-z0-9]/.test(v)) n++;
  $('#fuerza').className = 'fuerza' + (v ? ' f' + Math.max(n, 1) : '');
  $('#fuerza-txt').textContent = v ? ['Débil', 'Media', 'Fuerte'][Math.max(n, 1) - 1] : '';
});

const falla = (el, msg) => { el.textContent = ''; setTimeout(() => el.textContent = msg, 0); };
function ocupado(form, v, txt) {
  const b = $('button[type=submit]', form);
  if (!b.dataset.txt) b.dataset.txt = b.innerHTML;
  b.disabled = v; b.innerHTML = v ? txt : b.dataset.txt;
}

$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#login-email').value.trim(), pass = $('#login-pass').value, err = $('#login-error');
  if (!sb) return falla(err, 'Falta configurar Supabase (config.js).');
  if (!emailOk(email)) return falla(err, 'Escribe un correo válido.');
  if (pass.length < 6) return falla(err, 'La contraseña debe tener al menos 6 caracteres.');
  err.textContent = ''; ocupado(e.target, true, 'Entrando…');
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  ocupado(e.target, false);
  if (error) return falla(err, msgError(error));
  e.target.reset(); cerrarModal();                       // el resto lo hace onAuthStateChange → aplicarSesion
});

$('#form-registro').addEventListener('submit', async e => {
  e.preventDefault();
  const v = id => $('#' + id).value.trim(), err = $('#reg-error');
  const nombre = v('reg-nombre'), p1 = $('#reg-pass').value, correo = v('reg-email');
  if (!sb) return falla(err, 'Falta configurar Supabase (config.js).');
  if (nombre.length < 3) return falla(err, 'Escribe tu nombre completo.');
  if (!emailOk(correo)) return falla(err, 'Correo no válido.');
  if (!/^\d{9}$/.test(v('reg-tel'))) return falla(err, 'El teléfono debe tener 9 dígitos.');
  if (!v('reg-fecha')) return falla(err, 'Ingresa tu fecha de nacimiento.');
  if (p1.length < 6) return falla(err, 'La contraseña debe tener al menos 6 caracteres.');
  if (p1 !== $('#reg-pass2').value) return falla(err, 'Las contraseñas no coinciden.');
  if (!$('#reg-terminos').checked) return falla(err, 'Debes aceptar los términos y condiciones.');
  err.textContent = ''; ocupado(e.target, true, 'Creando cuenta…');
  const { data, error } = await sb.auth.signUp({
    email: correo, password: p1,
    options: { data: { nombre, telefono: v('reg-tel'), fecha_nacimiento: v('reg-fecha') } },
  });
  ocupado(e.target, false);
  if (error) return falla(err, msgError(error));
  if (data.user && data.user.identities && data.user.identities.length === 0) return falla(err, 'Ese correo ya está registrado. Inicia sesión.');
  e.target.reset(); $('#fuerza').className = 'fuerza'; $('#fuerza-txt').textContent = '';
  if (!data.session) {                                   // el proyecto exige confirmar el correo
    cambiarModo('login'); $('#login-email').value = correo;
    aviso('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.');
  } else cerrarModal();
});

// Se ejecuta cada vez que alguien inicia o cierra sesión
let primeraSesion = true;
async function aplicarSesion(session) {
  const eraVisitante = !usuario;
  usuario = session ? session.user : null;
  perfil = null;
  if (usuario) {
    const { data } = await sb.from('profiles').select('*').eq('id', usuario.id).maybeSingle();
    perfil = data || { id: usuario.id, nombre: usuario.user_metadata?.nombre || usuario.email.split('@')[0], rol: 'usuario' };
  }
  pintarNav();
  await cargarFavoritos();
  if (usuario && eraVisitante && !primeraSesion) {
    const n = nombreCorto();
    aviso(`¡Bienvenido, ${n}!${perfil.rol === 'admin' ? ' (modo administrador)' : ''}`);
    if (irAPagoTrasLogin && lineasCarrito().length) { irAPagoTrasLogin = false; abrirVista('pago'); }
    else $('#catalogo').scrollIntoView({ behavior: 'smooth' });
  }
  if (!usuario && !primeraSesion) cerrarVista();
  primeraSesion = false;
}
const nombreCorto = () => cap(((perfil && perfil.nombre) || (usuario && usuario.email) || 'amigo').split(/[\s@._-]/)[0]);

function pintarNav() {
  const dentro = !!usuario;
  $('#btn-sesion').hidden = dentro; $('#btn-sesion-movil').hidden = dentro;
  $('#cuenta-wrap').hidden = !dentro;
  $$('.solo-visitante').forEach(el => el.hidden = dentro);
  if (!dentro) { $('#menu-usuario').hidden = true; return; }
  const n = nombreCorto();
  $('#chip-ini').textContent = n[0].toUpperCase(); $('#chip-nombre').textContent = n;
  $('#mu-nombre').textContent = (perfil && perfil.nombre) || n; $('#mu-correo').textContent = usuario.email;
  const admin = perfil && perfil.rol === 'admin';
  $('#mu-rol').hidden = !admin; $('#mu-admin').hidden = !admin;
}

// menú de la cuenta
$('#btn-cuenta').addEventListener('click', e => {
  e.stopPropagation();
  const m = $('#menu-usuario'); m.hidden = !m.hidden; $('#btn-cuenta').setAttribute('aria-expanded', String(!m.hidden));
});
document.addEventListener('click', e => { if (!e.target.closest('#cuenta-wrap')) $('#menu-usuario').hidden = true; });
$('#menu-usuario').addEventListener('click', e => {
  const b = e.target.closest('[data-vista]'); if (!b) return;
  $('#menu-usuario').hidden = true; abrirVista(b.dataset.vista);
});
$('#btn-salir').addEventListener('click', async () => {
  $('#menu-usuario').hidden = true;
  const { error } = await sb.auth.signOut();
  error ? aviso(msgError(error)) : aviso('Sesión cerrada. ¡Hasta pronto!');
});

// =====================================================================
//  VISTAS DE CUENTA: perfil, pedidos, favoritos, pago
// =====================================================================
const vista = $('#vista'), cuerpo = $('#vista-cuerpo');
function abrirVista(nombre) {
  if (!usuario) return abrirModal('login');
  vista.classList.add('ver'); vista.setAttribute('aria-hidden', 'false');
  ({ perfil: vistaPerfil, pedidos: vistaPedidos, favoritos: vistaFavoritos, pago: vistaPago }[nombre])();
}
function cerrarVista() { vista.classList.remove('ver'); vista.setAttribute('aria-hidden', 'true'); }
$('#cerrar-vista').addEventListener('click', cerrarVista);
vista.addEventListener('click', e => { if (e.target === vista) cerrarVista(); });
addEventListener('keydown', e => { if (e.key === 'Escape') { cerrarModal(); cerrarVista(); abrirCarrito(false); $('#menu-usuario').hidden = true; } });

// ----- Mi perfil -----
function vistaPerfil() {
  cuerpo.innerHTML = `
    <h3>Mi perfil</h3><p class="sub">${perfil.rol === 'admin' ? 'Cuenta de administrador' : 'Tus datos personales'}</p>
    <form id="form-perfil" novalidate>
      <label class="campo solo-lectura"><svg><use href="#i-mail"/></svg><input type="email" value="${esc(usuario.email)}" readonly></label>
      <label class="campo"><svg><use href="#i-user"/></svg><input type="text" id="pf-nombre" placeholder="Nombre completo" value="${esc(perfil.nombre)}"></label>
      <label class="campo"><svg><use href="#i-phone"/></svg><input type="tel" id="pf-tel" placeholder="Teléfono" maxlength="9" value="${esc(perfil.telefono)}"></label>
      <p class="error" id="pf-error"></p>
      <button class="btn bloque" type="submit">Guardar cambios <svg><use href="#i-check"/></svg></button>
    </form>`;
  $('#form-perfil').addEventListener('submit', async e => {
    e.preventDefault();
    const nombre = $('#pf-nombre').value.trim(), tel = $('#pf-tel').value.trim(), err = $('#pf-error');
    if (nombre.length < 3) return falla(err, 'Escribe tu nombre completo.');
    if (tel && !/^\d{9}$/.test(tel)) return falla(err, 'El teléfono debe tener 9 dígitos.');
    err.textContent = ''; ocupado(e.target, true, 'Guardando…');
    const { error } = await sb.from('profiles').update({ nombre, telefono: tel || null }).eq('id', usuario.id);
    ocupado(e.target, false);
    if (error) return falla(err, msgError(error));
    perfil.nombre = nombre; perfil.telefono = tel || null; pintarNav(); aviso('Perfil actualizado ✔');
  });
}

// ----- Mis pedidos -----
async function vistaPedidos() {
  cuerpo.innerHTML = '<h3>Mis pedidos</h3><p class="cargando">Cargando…</p>';
  const { data, error } = await sb.from('pedidos').select('*, pedido_items(*)').eq('usuario_id', usuario.id).order('creado_en', { ascending: false });
  if (error) return cuerpo.innerHTML = `<h3>Mis pedidos</h3><p class="vacio-v">${esc(msgError(error))}</p>`;
  if (!data.length) return cuerpo.innerHTML = '<h3>Mis pedidos</h3><div class="vacio-v"><svg><use href="#i-box"/></svg><p>Aún no has hecho pedidos.<br>¡Pide tu primer café!</p></div>';
  cuerpo.innerHTML = '<h3>Mis pedidos</h3><p class="sub">Tu historial de compras</p>' + data.map(p => `
    <div class="pedido">
      <div class="pedido-cab"><b>Pedido #${p.id}</b><span class="estado ${esc(p.estado)}">${esc(p.estado)}</span></div>
      <small>${new Date(p.creado_en).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' })} · ${esc(p.metodo_pago)}</small>
      <ul>${p.pedido_items.map(i => `<li><span>${i.cantidad} × ${esc(i.nombre)}</span><span>${soles(i.cantidad * i.precio_unitario)}</span></li>`).join('')}</ul>
      <div class="pedido-pie"><b>${soles(p.total)}</b><button class="mini-btn" data-repetir="${p.id}">Volver a pedir</button></div>
    </div>`).join('');
  cuerpo.onclick = e => {
    const b = e.target.closest('[data-repetir]'); if (!b) return;
    const ped = data.find(x => x.id == b.dataset.repetir); let n = 0;
    ped.pedido_items.forEach(i => { if (i.producto_id && prod(i.producto_id)) { agregar(i.producto_id, i.cantidad, true); n++; } });
    if (!n) return aviso('Esos productos ya no están disponibles');
    cerrarVista(); abrirCarrito(true); aviso('Productos añadidos al carrito');
  };
}

// ----- Favoritos -----
function vistaFavoritos() {
  const lista = productos.filter(p => favoritos.has(p.id));
  if (!lista.length) return cuerpo.innerHTML = '<h3>Favoritos</h3><div class="vacio-v"><svg><use href="#i-heart"/></svg><p>Todavía no tienes favoritos.<br>Toca el corazón ♥ en cualquier café.</p></div>';
  cuerpo.innerHTML = '<h3>Favoritos</h3><p class="sub">Tus cafés preferidos</p>' + lista.map(p => `
    <div class="pedido"><div class="pedido-cab"><b>${esc(p.nombre)}</b><span class="precio" style="font-size:18px">${soles(p.precio)}</span></div>
      <small>${esc(p.descripcion)}</small>
      <div class="pedido-pie" style="margin-top:10px"><button class="mini-btn" data-quitarfav="${p.id}" style="background:#f1e6d1;color:#3B2415">Quitar</button>
        <button class="mini-btn" data-addfav="${p.id}">Añadir al carrito</button></div></div>`).join('');
  cuerpo.onclick = async e => {
    const a = e.target.closest('[data-addfav]'), q = e.target.closest('[data-quitarfav]');
    if (a) agregar(+a.dataset.addfav);
    if (q) { await alternarFavorito(+q.dataset.quitarfav); vistaFavoritos(); }
  };
}

// ----- Pago -----
function vistaPago() {
  const ls = lineasCarrito();
  if (!ls.length) return cuerpo.innerHTML = '<h3>Pago</h3><div class="vacio-v"><svg><use href="#i-cart"/></svg><p>Tu carrito está vacío.</p></div>';
  cuerpo.innerHTML = `
    <h3>Finalizar pedido</h3><p class="sub">Dónde lo entregamos y cómo pagas</p>
    <form id="form-pago" novalidate>
      <label class="campo"><svg><use href="#i-pin"/></svg><input type="text" id="pg-dir" placeholder="Dirección de entrega" autocomplete="street-address"></label>
      <div class="metodos">
        <label><input type="radio" name="metodo" value="yape" checked><span>Yape<small>Pago móvil</small></span></label>
        <label><input type="radio" name="metodo" value="tarjeta"><span>Tarjeta<small>Crédito / débito</small></span></label>
        <label><input type="radio" name="metodo" value="efectivo"><span>Efectivo<small>Al recibir</small></span></label>
      </div>
      <div class="resumen">
        ${ls.map(l => `<div><span>${l.cant} × ${esc(prod(l.id).nombre)}</span><span>${soles(l.cant * prod(l.id).precio)}</span></div>`).join('')}
        <div class="tot"><span>Total</span><b>${soles(totalCarrito())}</b></div>
      </div>
      <p class="nota">Pago simulado para el proyecto: no se cobra ni se guardan datos de tarjeta. El total lo confirma el servidor.</p>
      <p class="error" id="pg-error"></p>
      <button class="btn bloque" type="submit">Confirmar pedido <svg><use href="#i-arrow"/></svg></button>
    </form>`;
  $('#form-pago').addEventListener('submit', async e => {
    e.preventDefault();
    const dir = $('#pg-dir').value.trim(), metodo = $('input[name=metodo]:checked').value, err = $('#pg-error');
    if (dir.length < 5) return falla(err, 'Escribe una dirección de entrega válida.');
    err.textContent = ''; ocupado(e.target, true, 'Procesando…');
    const items = ls.map(l => ({ producto_id: l.id, cantidad: l.cant }));
    const { data, error } = await sb.rpc('crear_pedido', { p_items: items, p_direccion: dir, p_metodo: metodo });
    ocupado(e.target, false);
    if (error) return falla(err, msgError(error));
    carrito = []; guardarCarrito(); dibujarCarrito();
    cuerpo.innerHTML = `<div class="ok-grande"><div class="visto"><svg><use href="#i-check"/></svg></div>
      <h3>¡Pedido confirmado!</h3><p class="sub">Tu pedido <b>#${data}</b> fue registrado y está <b>pendiente</b>.</p>
      <button class="btn bloque" data-vista-ir="pedidos">Ver mis pedidos</button>
      <button class="btn bloque secundario" data-vista-ir="cerrar">Seguir comprando</button></div>`;
    cuerpo.onclick = ev => {
      const b = ev.target.closest('[data-vista-ir]'); if (!b) return;
      b.dataset.vistaIr === 'pedidos' ? vistaPedidos() : cerrarVista();
    };
  });
}

// =====================================================================
//  Animaciones al hacer scroll + arranque
// =====================================================================
$$('.encabezado,.servicios article,.nos-vis,.nos-txt,.cta .contenedor,.herramientas').forEach(el => el.classList.add('rev'));
const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('visto'); io.unobserve(x.target); } }), { threshold: .12 });
$$('.rev').forEach(el => io.observe(el));

(() => { const im = new Image(); im.onload = () => $('.nos-vis').classList.add('foto'); im.src = 'img/nosotros.jpg'; })();

dibujarCarrito();
cargarCatalogo();
if (sb) {
  sb.auth.getSession().then(({ data }) => aplicarSesion(data.session));
  // importante: no usar "await" dentro de este callback (lo recomienda Supabase)
  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === 'INITIAL_SESSION') return;
    setTimeout(() => aplicarSesion(session), 0);
  });
} else pintarNav();


// ---- Acceso discreto al panel de administrador ----
// 1) Atajo de teclado: Ctrl + Alt + A
// 2) 5 clics seguidos sobre la línea "© 2026 Café Aroma" del pie de página
// (admin.html sigue validando el rol real en Supabase; esto solo es un atajo de navegación)
(function () {
  const ir = () => { location.href = 'admin.html'; };
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); ir(); }
  });
  const pie = document.getElementById('pie-secreto');
  if (pie) {
    let n = 0, t;
    pie.addEventListener('click', () => {
      n++; clearTimeout(t); t = setTimeout(() => n = 0, 1500);
      if (n >= 5) { n = 0; ir(); }
    });
  }
})();
