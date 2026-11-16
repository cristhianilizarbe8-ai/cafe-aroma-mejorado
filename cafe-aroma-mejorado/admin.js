/* =========================================================
   Café Aroma · Panel de administración (Supabase)
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const soles = n => 'S/. ' + (Math.round(Number(n) * 100) / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fechaCorta = d => new Date(d).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
const fotoAdmin = nombre => {
  const n = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return ({capuchino:'img/capuchino.jpg',cappuccino:'img/capuchino.jpg',espresso:'img/espresso.jpg',americano:'img/americano.jpg',ristretto:'img/ristretto.jpg',latte:'img/latte.jpg',mocha:'img/mocha.jpg',mocca:'img/mocha.jpg'})[n] || 'img/hero-cafe.jpg';
};
const imagenAdmin = p => `<img src="${esc(p.imagen_url || fotoAdmin(p.nombre))}" data-respaldo="${fotoAdmin(p.nombre)}" alt="" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.respaldo">`;

// ---------- Conexión ----------
const CFG = window.CAFE_CONFIG || {};
const configurado = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
  !CFG.SUPABASE_URL.includes('TU-PROYECTO') && !CFG.SUPABASE_ANON_KEY.includes('TU_ANON') && window.supabase);
const sb = configurado ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

function msgError(err) {
  const m = (err && err.message) || String(err || '');
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(m)) return 'Confirma tu correo antes de entrar.';
  if (/failed to fetch|network/i.test(m)) return 'No hay conexión con el servidor.';
  if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para hacer esto.';
  if (/violates foreign key/i.test(m)) return 'No se puede eliminar: está en uso.';
  return m || 'Ocurrió un error.';
}
let tToast;
function aviso(txt, mal = false) {
  const t = $('#toast'); t.textContent = txt; t.classList.toggle('mal', mal); t.classList.add('ver');
  clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove('ver'), 3000);
}
const falla = (el, msg) => { el.textContent = ''; setTimeout(() => el.textContent = msg, 0); };
const abrir = id => { const m = $(id); m.classList.add('ver'); m.setAttribute('aria-hidden', 'false'); };
const cerrar = id => { const m = $(id); m.classList.remove('ver'); m.setAttribute('aria-hidden', 'true'); };
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-cerrar]')) cerrar('#' + m.id); }));
addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal.ver').forEach(m => cerrar('#' + m.id)); });

// Ventana de confirmación (reemplaza a confirm())
function confirmar(titulo, texto, botonTxt = 'Confirmar') {
  return new Promise(res => {
    $('#mc-titulo').textContent = titulo; $('#mc-texto').textContent = texto; $('#mc-si').textContent = botonTxt;
    abrir('#m-confirm');
    const fin = v => { cerrar('#m-confirm'); $('#mc-si').onclick = $('#mc-no').onclick = null; res(v); };
    $('#mc-si').onclick = () => fin(true); $('#mc-no').onclick = () => fin(false);
  });
}

// =====================================================================
//  ACCESO Y PERMISOS
// =====================================================================
let yo = null;     // perfil del administrador

async function iniciar() {
  if (!sb) { $('#aviso-config').hidden = false; $('#acceso').hidden = false; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('#app').hidden = true; $('#sin-permiso').hidden = true; $('#acceso').hidden = false; return; }
  const { data: perfil, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  $('#acceso').hidden = true;
  if (error || !perfil || perfil.rol !== 'admin') { $('#app').hidden = true; $('#sin-permiso').hidden = false; return; }   // ← control de acceso
  yo = perfil;
  $('#sin-permiso').hidden = true; $('#app').hidden = false;
  const n = perfil.nombre || session.user.email;
  $('#yo-nombre').textContent = n; $('#yo-ini').textContent = n[0].toUpperCase();
  irA('dashboard');
}
$('#form-acceso').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#ac-email').value.trim(), pass = $('#ac-pass').value, err = $('#ac-error');
  if (!sb) return falla(err, 'Falta configurar Supabase (config.js).');
  if (!emailOk(email) || pass.length < 6) return falla(err, 'Escribe tu correo y contraseña.');
  err.textContent = '';
  const b = $('button[type=submit]', e.target); b.disabled = true; b.textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  b.disabled = false; b.textContent = 'Entrar';
  if (error) return falla(err, msgError(error));
  e.target.reset(); iniciar();
});
async function salir() { await sb.auth.signOut(); yo = null; iniciar(); }
$('#btn-salir').addEventListener('click', salir);
$('#sp-salir').addEventListener('click', salir);

// =====================================================================
//  NAVEGACIÓN
// =====================================================================
const TITULOS = { dashboard: 'Dashboard', productos: 'Productos', pedidos: 'Pedidos', usuarios: 'Usuarios' };
const CARGAR = { dashboard: cargarDashboard, productos: cargarProductos, pedidos: cargarPedidos, usuarios: cargarUsuarios };
function irA(sec) {
  $$('#lat-nav button').forEach(b => b.classList.toggle('on', b.dataset.sec === sec));
  $$('.sec').forEach(s => s.hidden = s.id !== 'sec-' + sec);
  $('#titulo-sec').textContent = TITULOS[sec];
  cerrarLateral(); CARGAR[sec]();
}
$('#lat-nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) irA(b.dataset.sec); });
const cerrarLateral = () => { $('#lateral').classList.remove('abierto'); $('#velo').classList.remove('ver'); };
$('#btn-lateral').addEventListener('click', () => { $('#lateral').classList.add('abierto'); $('#velo').classList.add('ver'); });
$('#velo').addEventListener('click', cerrarLateral);

const cargando = (tabla, cols) => tabla.innerHTML = `<tbody><tr><td class="vacio" colspan="${cols}">Cargando…</td></tr></tbody>`;
const vacio = (tabla, cols, txt) => tabla.innerHTML = `<tbody><tr><td class="vacio" colspan="${cols}">${txt}</td></tr></tbody>`;

// =====================================================================
//  DASHBOARD
// =====================================================================
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const claveDia = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

async function cargarDashboard() {
  const periodo = Number($('#dash-periodo')?.value || 7);
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  desde.setDate(desde.getDate() - (periodo - 1));
  const desdeISO = desde.toISOString();

  const [ped, prods, users, pend] = await Promise.all([
    sb.from('pedidos')
      .select('id,total,estado,creado_en,metodo_pago,profiles(nombre),pedido_items(cantidad,precio_unitario,nombre)')
      .gte('creado_en', desdeISO)
      .order('creado_en', { ascending: false })
      .limit(500),
    sb.from('productos').select('id', { count: 'exact', head: true }).eq('activo', true),
    sb.from('profiles').select('id', { count: 'exact', head: true }).eq('rol', 'usuario'),
    sb.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
  ]);

  const error = ped.error || prods.error || users.error || pend.error;
  if (error) {
    aviso(msgError(error), true);
    $('#dash-actualizado').textContent = 'No se pudieron actualizar todos los indicadores. Revisa la conexión y los permisos.';
    return;
  }

  const pedidos = ped.data || [];
  const entregados = pedidos.filter(p => p.estado === 'entregado');
  const ventas = entregados.reduce((s, p) => s + Number(p.total || 0), 0);
  const ticket = entregados.length ? ventas / entregados.length : 0;
  const pill = $('#pill-pend');
  pill.hidden = !(pend.count || 0);
  pill.textContent = pend.count || 0;

  // Indicadores principales del periodo seleccionado.
  $('#k-pedidos').textContent = pedidos.length;
  $('#k-pedidos-nota').textContent = `Últimos ${periodo} días`;
  $('#k-ventas').textContent = soles(ventas);
  $('#k-ticket').textContent = soles(ticket);
  $('#k-pendientes').textContent = pend.count ?? '–';
  $('#k-productos').textContent = prods.count ?? '–';
  $('#k-usuarios').textContent = users.count ?? '–';

  // Gráfico de ventas por día: únicamente pedidos entregados.
  $('#grafico-titulo').textContent = `Ventas de los últimos ${periodo} días`;
  const dias = [...Array(periodo)].map((_, i) => {
    const d = new Date(desde);
    d.setDate(d.getDate() + i);
    return { d, total: 0 };
  });
  entregados.forEach(p => {
    const x = dias.find(z => claveDia(z.d) === claveDia(new Date(p.creado_en)));
    if (x) x.total += Number(p.total || 0);
  });
  const max = Math.max(...dias.map(x => x.total), 1);
  const W = 840, H = 250, base = 205;
  const bw = periodo === 7 ? 54 : 16;
  const gap = (W - bw * periodo) / (periodo + 1);
  $('#grafico').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas entregadas de los últimos ${periodo} días">
    <defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8B765"/><stop offset="1" stop-color="#7A3E14"/></linearGradient></defs>
    <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#eadfc9"/>
    ${dias.map((x, i) => {
      const h = Math.round((x.total / max) * 150);
      const px = gap + i * (bw + gap);
      const label = periodo === 7 || i % 5 === 0 || i === periodo - 1;
      return `<rect x="${px}" y="${base - h}" width="${bw}" height="${Math.max(h, x.total ? 3 : 2)}" rx="${Math.min(8, bw / 2)}" fill="url(#gb)" opacity="${x.total ? 1 : .22}">
          <title>${x.d.toLocaleDateString('es-PE')}: ${soles(x.total)}</title></rect>
        ${periodo === 7 && x.total ? `<text class="val" x="${px + bw / 2}" y="${base - h - 9}" text-anchor="middle">${Math.round(x.total)}</text>` : ''}
        ${label ? `<text x="${px + bw / 2}" y="${base + 23}" text-anchor="middle">${periodo === 7 ? DIAS[x.d.getDay()] + ' ' : ''}${x.d.getDate()}</text>` : ''}`;
    }).join('')}</svg>`;

  // Pedidos recientes del periodo.
  $('#recientes').innerHTML = pedidos.slice(0, 6).map(p => `
    <div class="rec"><div><b style="color:inherit">#${p.id} · ${esc(p.profiles?.nombre || 'Cliente')}</b><small>${fechaCorta(p.creado_en)}</small></div>
      <div style="text-align:right"><b>${soles(p.total)}</b><br><span class="estado ${esc(p.estado)}">${esc(p.estado)}</span></div></div>`).join('') || '<p class="vacio">Aún no hay pedidos en este periodo.</p>';

  // Distribución de pedidos por estado.
  const estados = [
    { key: 'pendiente', label: 'Pendientes' },
    { key: 'preparando', label: 'Preparando' },
    { key: 'entregado', label: 'Entregados' },
    { key: 'cancelado', label: 'Cancelados' },
  ];
  $('#estado-resumen').innerHTML = estados.map(e => {
    const n = pedidos.filter(p => p.estado === e.key).length;
    const pct = pedidos.length ? n / pedidos.length * 100 : 0;
    return `<div class="barra-estado"><div><span><i class="punto ${e.key}"></i>${e.label}</span><b>${n}</b></div><div class="pista"><span class="relleno ${e.key}" style="width:${pct}%"></span></div></div>`;
  }).join('') || '<p class="vacio">Sin pedidos para mostrar.</p>';

  // Preferencias de pago según pedidos no cancelados.
  const pagos = [
    { key: 'yape', label: 'Yape' },
    { key: 'efectivo', label: 'Efectivo' },
    { key: 'tarjeta', label: 'Tarjeta' },
  ];
  const pedidosValidos = pedidos.filter(p => p.estado !== 'cancelado');
  $('#pagos-resumen').innerHTML = pagos.map((m, i) => {
    const n = pedidosValidos.filter(p => (p.metodo_pago || '').toLowerCase() === m.key).length;
    const pct = pedidosValidos.length ? Math.round(n / pedidosValidos.length * 100) : 0;
    return `<div class="pago-fila"><span><i class="pago-icono">${['Y','S/','T'][i]}</i>${m.label}</span><b>${n} <small>${pct}%</small></b></div>`;
  }).join('');

  // Productos más vendidos por unidades en pedidos entregados.
  const ranking = new Map();
  entregados.forEach(p => (p.pedido_items || []).forEach(item => {
    const nombre = item.nombre || 'Producto sin nombre';
    const actual = ranking.get(nombre) || { nombre, unidades: 0, importe: 0 };
    actual.unidades += Number(item.cantidad || 0);
    actual.importe += Number(item.cantidad || 0) * Number(item.precio_unitario || 0);
    ranking.set(nombre, actual);
  }));
  const top = [...ranking.values()].sort((a, b) => b.unidades - a.unidades).slice(0, 5);
  $('#productos-top').innerHTML = top.length ? top.map((p, i) => `
    <div class="top-fila"><span class="top-num">${i + 1}</span><div class="top-info"><b>${esc(p.nombre)}</b><small>${p.unidades} unidades vendidas</small></div><strong>${soles(p.importe)}</strong></div>`).join('') : '<p class="vacio">Aún no hay ventas entregadas en este periodo.</p>';

  $('#dash-actualizado').textContent = `Datos actualizados: ${new Date().toLocaleString('es-PE')}. Las ventas y los productos más vendidos consideran pedidos entregados.`;
}

$('#dash-periodo').addEventListener('change', cargarDashboard);
$('#dash-actualizar').addEventListener('click', cargarDashboard);
document.querySelectorAll('[data-ir-pedidos]').forEach(b => b.addEventListener('click', () => irA('pedidos')));
document.querySelectorAll('[data-ir-productos]').forEach(b => b.addEventListener('click', () => irA('productos')));

// =====================================================================
//  PRODUCTOS
// =====================================================================
let productos = [], categorias = [];
async function cargarProductos() {
  const t = $('#tabla-productos'); cargando(t, 6);
  const [p, c] = await Promise.all([
    sb.from('productos').select('*, categorias(nombre)').order('id'),
    sb.from('categorias').select('id,nombre').order('nombre'),
  ]);
  if (p.error || c.error) return vacio(t, 6, esc(msgError(p.error || c.error)));
  productos = p.data; categorias = c.data;
  $('#mp-cat').innerHTML = categorias.map(x => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('');
  dibujarProductos();
}
function dibujarProductos() {
  const q = $('#p-buscar').value.trim().toLowerCase(), t = $('#tabla-productos');
  const lista = productos.filter(p => p.nombre.toLowerCase().includes(q));
  if (!lista.length) return vacio(t, 6, 'No hay productos.');
  t.innerHTML = `<thead><tr><th></th><th>Producto</th><th>Categoría</th><th class="num">Precio</th><th>Visible</th><th></th></tr></thead><tbody>` +
    lista.map(p => `<tr>
      <td><div class="mini-foto">${imagenAdmin(p)}</div></td>
      <td><b>${esc(p.nombre)}</b> ${p.nuevo ? '<span class="tag">Nuevo</span>' : ''}<div class="dato">${esc(p.descripcion)}</div></td>
      <td>${esc(p.categorias?.nombre || '—')}</td>
      <td class="num"><b>${soles(p.precio)}</b></td>
      <td><label class="interruptor"><input type="checkbox" data-activo="${p.id}" ${p.activo ? 'checked' : ''}><span></span></label></td>
      <td><div class="acc"><button data-editar="${p.id}" aria-label="Editar"><svg><use href="#i-edit"/></svg></button>
        <button class="del" data-borrar="${p.id}" aria-label="Eliminar"><svg><use href="#i-trash"/></svg></button></div></td></tr>`).join('') + '</tbody>';
}
$('#p-buscar').addEventListener('input', dibujarProductos);
$('#tabla-productos').addEventListener('click', async e => {
  const ed = e.target.closest('[data-editar]'), del = e.target.closest('[data-borrar]');
  if (ed) return formProducto(productos.find(p => p.id == ed.dataset.editar));
  if (del) {
    const p = productos.find(x => x.id == del.dataset.borrar);
    if (!await confirmar('¿Eliminar producto?', `«${p.nombre}» se borrará de la carta. Los pedidos anteriores se conservan. Si solo quieres ocultarlo, usa el interruptor «Visible».`, 'Eliminar')) return;
    const { error } = await sb.from('productos').delete().eq('id', p.id);
    if (error) return aviso(msgError(error), true);
    aviso('Producto eliminado'); cargarProductos();
  }
});
$('#tabla-productos').addEventListener('change', async e => {
  const c = e.target.closest('[data-activo]'); if (!c) return;
  const { error } = await sb.from('productos').update({ activo: c.checked }).eq('id', c.dataset.activo);
  if (error) { c.checked = !c.checked; return aviso(msgError(error), true); }
  aviso(c.checked ? 'Producto visible en la tienda' : 'Producto oculto'); productos.find(p => p.id == c.dataset.activo).activo = c.checked;
});

let editando = null, archivoNuevo = null;
function formProducto(p) {
  editando = p || null; archivoNuevo = null;
  $('#mp-titulo').textContent = p ? 'Editar producto' : 'Nuevo producto';
  $('#mp-nombre').value = p?.nombre || ''; $('#mp-desc').value = p?.descripcion || '';
  $('#mp-precio').value = p?.precio ?? ''; $('#mp-cat').value = p?.categoria_id || categorias[0]?.id || '';
  $('#mp-activo').checked = p ? p.activo : true; $('#mp-nuevo').checked = !!p?.nuevo;
  $('#mp-file').value = ''; $('#mp-error').textContent = '';
  vistaFoto(p?.imagen_url); abrir('#m-producto');
}
function vistaFoto(url) {
  $('#mp-vista').innerHTML = '<svg><use href="#i-cup"/></svg>' + (url ? `<img src="${esc(url)}" alt="" onerror="this.remove()">` : '');
}
$('#p-nuevo').addEventListener('click', () => formProducto(null));
$('#mp-file').addEventListener('change', e => {
  const f = e.target.files[0], err = $('#mp-error'); archivoNuevo = null;
  if (!f) return vistaFoto(editando?.imagen_url);
  if (!/^image\//.test(f.type)) { e.target.value = ''; return falla(err, 'El archivo debe ser una imagen.'); }
  if (f.size > 2 * 1024 * 1024) { e.target.value = ''; return falla(err, 'La imagen pesa más de 2 MB.'); }
  err.textContent = ''; archivoNuevo = f; vistaFoto(URL.createObjectURL(f));
});
$('#form-producto').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#mp-error'), nombre = $('#mp-nombre').value.trim(), precio = parseFloat($('#mp-precio').value);
  if (nombre.length < 2) return falla(err, 'Escribe el nombre del producto.');
  if (!(precio >= 0) || isNaN(precio)) return falla(err, 'Escribe un precio válido.');
  if (!$('#mp-cat').value) return falla(err, 'Elige una categoría.');
  err.textContent = '';
  const b = $('button[type=submit]', e.target); b.disabled = true; b.textContent = 'Guardando…';
  try {
    let imagen_url = editando?.imagen_url || null;
    if (archivoNuevo) {                                           // sube la foto al Storage
      const ext = (archivoNuevo.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const ruta = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await sb.storage.from('productos').upload(ruta, archivoNuevo, { contentType: archivoNuevo.type, cacheControl: '3600' });
      if (up.error) throw up.error;
      imagen_url = sb.storage.from('productos').getPublicUrl(ruta).data.publicUrl;
    }
    const fila = { nombre, descripcion: $('#mp-desc').value.trim() || null, precio, categoria_id: +$('#mp-cat').value,
      imagen_url, activo: $('#mp-activo').checked, nuevo: $('#mp-nuevo').checked };
    const r = editando ? await sb.from('productos').update(fila).eq('id', editando.id) : await sb.from('productos').insert(fila);
    if (r.error) throw r.error;
    cerrar('#m-producto'); aviso(editando ? 'Producto actualizado ✔' : 'Producto creado ✔'); cargarProductos();
  } catch (x) { falla(err, msgError(x)); }
  finally { b.disabled = false; b.textContent = 'Guardar producto'; }
});

// =====================================================================
//  PEDIDOS
// =====================================================================
let pedidos = [];
const ESTADOS = ['pendiente', 'preparando', 'entregado', 'cancelado'];
async function cargarPedidos() {
  const t = $('#tabla-pedidos'); cargando(t, 6);
  let q = sb.from('pedidos').select('*, profiles(nombre,telefono), pedido_items(*)').order('creado_en', { ascending: false }).limit(200);
  if ($('#f-estado').value) q = q.eq('estado', $('#f-estado').value);
  const { data, error } = await q;
  if (error) return vacio(t, 6, esc(msgError(error)));
  pedidos = data;
  if (!data.length) return vacio(t, 6, 'No hay pedidos con ese filtro.');
  t.innerHTML = `<thead><tr><th>#</th><th>Cliente</th><th>Fecha</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead><tbody>` +
    data.map(p => `<tr>
      <td><b>#${p.id}</b></td><td>${esc(p.profiles?.nombre || 'Cliente')}</td><td>${fechaCorta(p.creado_en)}</td>
      <td class="num"><b>${soles(p.total)}</b></td>
      <td><select class="sel" data-estado="${p.id}" data-prev="${esc(p.estado)}">${ESTADOS.map(s => `<option value="${s}" ${s === p.estado ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></td>
      <td><div class="acc"><button data-ver="${p.id}" aria-label="Ver detalle"><svg><use href="#i-eye"/></svg></button></div></td></tr>`).join('') + '</tbody>';
}
$('#f-estado').addEventListener('change', cargarPedidos);
$('#ped-recargar').addEventListener('click', cargarPedidos);
$('#tabla-pedidos').addEventListener('change', async e => {
  const s = e.target.closest('[data-estado]'); if (!s) return;
  const nuevo = s.value, id = s.dataset.estado;
  if (nuevo === 'cancelado' && !await confirmar('¿Cancelar pedido?', `El pedido #${id} pasará a «cancelado» y no contará en las ventas.`, 'Cancelar pedido')) { s.value = s.dataset.prev; return; }
  const { error } = await sb.from('pedidos').update({ estado: nuevo }).eq('id', id);
  if (error) { s.value = s.dataset.prev; return aviso(msgError(error), true); }
  s.dataset.prev = nuevo; pedidos.find(p => p.id == id).estado = nuevo; aviso(`Pedido #${id}: ${nuevo}`);
});
$('#tabla-pedidos').addEventListener('click', e => {
  const b = e.target.closest('[data-ver]'); if (!b) return;
  const p = pedidos.find(x => x.id == b.dataset.ver);
  $('#mped-cuerpo').innerHTML = `
    <h3>Pedido #${p.id}</h3><span class="estado ${esc(p.estado)}">${esc(p.estado)}</span>
    <p class="dato">Cliente: <b>${esc(p.profiles?.nombre || '—')}</b> · Tel: <b>${esc(p.profiles?.telefono || '—')}</b></p>
    <p class="dato">Fecha: <b>${fechaCorta(p.creado_en)}</b></p>
    <p class="dato">Entrega: <b>${esc(p.direccion || '—')}</b></p>
    <p class="dato">Pago: <b>${esc(p.metodo_pago || '—')}</b></p>
    <div class="det">${p.pedido_items.map(i => `<div><span>${i.cantidad} × ${esc(i.nombre)}</span><span>${soles(i.cantidad * i.precio_unitario)}</span></div>`).join('')}
      <div class="tot"><span>Total</span><b>${soles(p.total)}</b></div></div>`;
  abrir('#m-pedido');
});

// =====================================================================
//  USUARIOS
// =====================================================================
async function cargarUsuarios() {
  const t = $('#tabla-usuarios'); cargando(t, 5);
  const [u, p] = await Promise.all([
    sb.from('profiles').select('*').order('creado_en', { ascending: false }),
    sb.from('pedidos').select('usuario_id'),
  ]);
  if (u.error || p.error) return vacio(t, 5, esc(msgError(u.error || p.error)));
  const cuenta = {}; p.data.forEach(x => cuenta[x.usuario_id] = (cuenta[x.usuario_id] || 0) + 1);
  t.innerHTML = `<thead><tr><th>Nombre</th><th>Teléfono</th><th>Rol</th><th class="num">Pedidos</th><th>Registro</th><th></th></tr></thead><tbody>` +
    u.data.map(x => `<tr>
      <td><b>${esc(x.nombre || '—')}</b>${x.id === yo.id ? ' <span class="tag">Tú</span>' : ''}</td>
      <td>${esc(x.telefono || '—')}</td>
      <td><span class="estado ${x.rol === 'admin' ? 'preparando' : 'entregado'}">${x.rol === 'admin' ? 'Admin' : 'Usuario'}</span></td>
      <td class="num">${cuenta[x.id] || 0}</td><td>${new Date(x.creado_en).toLocaleDateString('es-PE')}</td>
      <td>${x.id === yo.id ? '' : `<div class="acc"><button data-rol="${x.id}" data-a="${x.rol === 'admin' ? 'usuario' : 'admin'}" data-n="${esc(x.nombre || 'este usuario')}" title="Cambiar rol" style="width:auto;padding:0 12px;font:600 12px 'Inter'">${x.rol === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button></div>`}</td></tr>`).join('') + '</tbody>';
}
$('#tabla-usuarios').addEventListener('click', async e => {
  const b = e.target.closest('[data-rol]'); if (!b) return;
  const haceAdmin = b.dataset.a === 'admin';
  if (!await confirmar(haceAdmin ? '¿Dar permisos de administrador?' : '¿Quitar permisos de administrador?',
    haceAdmin ? `${b.dataset.n} podrá gestionar productos, pedidos y usuarios.` : `${b.dataset.n} volverá a ser un usuario normal.`, 'Confirmar')) return;
  const { error } = await sb.from('profiles').update({ rol: b.dataset.a }).eq('id', b.dataset.rol);
  if (error) return aviso(msgError(error), true);
  aviso('Rol actualizado ✔'); cargarUsuarios();
});

iniciar();
