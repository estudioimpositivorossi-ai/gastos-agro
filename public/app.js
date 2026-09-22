(() => {
  'use strict';

  const state = {
    user: null,
    categorias: [],
    establecimientos: [],
    selectedEstablecimientoId: '', // solo lo usa el admin
    activeTab: null,
    filtros: { desde: '', hasta: '', categoria: '' },
    pollTimer: null
  };

  const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const moneyDec = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function todayIso() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* respuesta vacía */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Error inesperado');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function openDialog(id) { document.getElementById(id).showModal(); }
  function closeDialog(id) { document.getElementById(id).close(); }

  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close-dialog]');
    if (closeBtn) closeDialog(closeBtn.dataset.closeDialog);
    const dlg = e.target.closest('dialog');
    if (dlg && e.target === dlg) dlg.close(); // click en el backdrop
  });

  // ---------- Compresión de imágenes ----------
  function compressImage(file, maxWidth = 1100, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.onload = () => { img.src = reader.result; };
      img.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- Arranque ----------
  async function init() {
    try {
      const { user } = await api('/api/me');
      state.user = user;
      await afterLogin();
    } catch (e) {
      renderLogin();
    }
  }

  async function afterLogin() {
    const [{ categorias }, { establecimientos }] = await Promise.all([
      api('/api/categorias'),
      api('/api/establecimientos')
    ]);
    state.categorias = categorias;
    state.establecimientos = establecimientos;
    if (state.user.rol === 'admin') {
      state.selectedEstablecimientoId = establecimientos[0]?.id || '';
    } else {
      state.selectedEstablecimientoId = state.user.establecimientoId;
    }
    if (state.user.debeCambiarPassword) {
      renderApp();
      openDialog('dlg-cambiar-password');
    } else {
      renderApp();
    }
  }

  // ---------- Login ----------
  function renderLogin() {
    stopPolling();
    document.getElementById('app').innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <div class="brand"><span class="brand-mark"></span><h1>Gastos Agro</h1></div>
          <div class="subtitle">Control de gastos operativos del campo, en tiempo real.</div>
          <div id="login-error"></div>
          <form id="form-login">
            <div class="field">
              <label for="login-user">Usuario</label>
              <input id="login-user" name="username" required autocapitalize="off" autocomplete="username" />
            </div>
            <div class="field">
              <label for="login-pass">Contraseña</label>
              <input id="login-pass" name="password" type="password" required autocomplete="current-password" />
            </div>
            <button type="submit" class="btn btn-primary btn-block">Ingresar</button>
          </form>
          <div class="demo-hint">Primer ingreso del estudio: usuario <strong>admin</strong>, contraseña <strong>admin123</strong> (te va a pedir cambiarla).</div>
        </div>
      </div>
    `;
    document.getElementById('form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('login-error');
      errEl.innerHTML = '';
      try {
        const { user } = await api('/api/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
        state.user = user;
        await afterLogin();
      } catch (err) {
        errEl.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
      }
    });
  }

  // ---------- Shell de la app ----------
  const TABS_BY_ROL = {
    admin: [
      { id: 'resumen', label: 'Resumen' },
      { id: 'gastos', label: 'Gastos' },
      { id: 'establecimientos', label: 'Establecimientos' },
      { id: 'usuarios', label: 'Usuarios' }
    ],
    cliente: [
      { id: 'resumen', label: 'Resumen' },
      { id: 'gastos', label: 'Gastos' }
    ],
    empleado: [
      { id: 'cargar', label: 'Cargar gasto' },
      { id: 'mis-gastos', label: 'Mis gastos' }
    ]
  };

  function rolLabel(rol) {
    return { admin: 'Estudio', cliente: 'Cliente', empleado: 'Empleado' }[rol] || rol;
  }

  function renderApp() {
    const tabs = TABS_BY_ROL[state.user.rol] || [];
    if (!state.activeTab || !tabs.some(t => t.id === state.activeTab)) {
      state.activeTab = tabs[0]?.id;
    }

    const estSelector = state.user.rol === 'admin' ? `
      <select class="est-select" id="est-selector">
        ${state.establecimientos.map(e => `<option value="${e.id}" ${e.id === state.selectedEstablecimientoId ? 'selected' : ''}>${escapeHtml(e.nombre)}</option>`).join('')}
      </select>
    ` : `<span class="pill">${escapeHtml(currentEstablecimiento()?.nombre || '')}</span>`;

    document.getElementById('app').innerHTML = `
      <div class="topbar">
        <div class="brand"><span class="brand-mark"></span><h1>Gastos Agro</h1></div>
        ${estSelector}
        <div class="topbar-spacer"></div>
        <span class="pill role-${state.user.rol}">${rolLabel(state.user.rol)} · ${escapeHtml(state.user.nombreCompleto)}</span>
        <button class="btn btn-secondary btn-sm" id="btn-cambiar-pw">Contraseña</button>
        <button class="btn btn-secondary btn-sm" id="btn-logout">Salir</button>
      </div>
      <div class="tabs">
        ${tabs.map(t => `<button class="tab-btn ${t.id === state.activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <main id="tab-content"></main>
    `;

    document.getElementById('btn-logout').addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' });
      state.user = null;
      renderLogin();
    });
    document.getElementById('btn-cambiar-pw').addEventListener('click', () => openDialog('dlg-cambiar-password'));

    const estSel = document.getElementById('est-selector');
    if (estSel) {
      estSel.addEventListener('change', () => {
        state.selectedEstablecimientoId = estSel.value;
        renderTab();
      });
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.tab;
        renderApp();
      });
    });

    setupDialogsOnce();
    renderTab();
    setupPolling();
  }

  function currentEstablecimiento() {
    return state.establecimientos.find(e => e.id === state.selectedEstablecimientoId);
  }

  function setupPolling() {
    stopPolling();
    const livePolling = ['resumen', 'gastos', 'mis-gastos'];
    if (!livePolling.includes(state.activeTab)) return;
    state.pollTimer = setInterval(() => {
      if (document.hidden) return;
      renderTab({ silent: true });
    }, 8000);
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function renderTab(opts = {}) {
    const container = document.getElementById('tab-content');
    if (!container) return;
    const renderers = {
      resumen: renderResumenTab,
      gastos: renderGastosTab,
      establecimientos: renderEstablecimientosTab,
      usuarios: renderUsuariosTab,
      cargar: renderCargarTab,
      'mis-gastos': renderGastosTab
    };
    const fn = renderers[state.activeTab];
    if (fn) await fn(container, opts);
  }

  // ---------- Tab: Resumen ----------
  async function renderResumenTab(container, opts) {
    const estId = state.selectedEstablecimientoId;
    if (!estId) {
      container.innerHTML = `<div class="empty-state">Todavía no hay ningún establecimiento creado.</div>`;
      return;
    }
    const params = new URLSearchParams({ establecimientoId: estId });
    if (state.filtros.desde) params.set('desde', state.filtros.desde);
    if (state.filtros.hasta) params.set('hasta', state.filtros.hasta);
    const resumen = await api(`/api/resumen?${params}`);

    if (!opts?.silent) {
      container.innerHTML = renderResumenShell(resumen);
      wireFiltrosResumen(container);
    } else {
      const body = container.querySelector('#resumen-body');
      if (body) body.innerHTML = renderResumenBody(resumen);
    }
  }

  function renderResumenShell(resumen) {
    return `
      <div class="card">
        <div class="card-head">
          <h2>Período</h2>
          <span class="pill"><span class="live-dot"></span> se actualiza solo</span>
        </div>
        <div class="filters">
          <input type="date" id="f-desde" value="${state.filtros.desde}" />
          <input type="date" id="f-hasta" value="${state.filtros.hasta}" />
          <button class="btn btn-secondary btn-sm" id="f-limpiar">Todo el historial</button>
        </div>
      </div>
      <div id="resumen-body">${renderResumenBody(resumen)}</div>
    `;
  }

  function renderResumenBody(resumen) {
    const max = Math.max(1, ...resumen.porCategoria.map(c => c.monto));
    return `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Total gastado</div><div class="value accent tabular">${money.format(resumen.total)}</div></div>
        <div class="kpi"><div class="label">Comprobantes</div><div class="value tabular">${resumen.cantidadGastos}</div></div>
        <div class="kpi"><div class="label">Promedio por gasto</div><div class="value tabular">${money.format(resumen.cantidadGastos ? resumen.total / resumen.cantidadGastos : 0)}</div></div>
      </div>
      <div class="card">
        <h2>Por categoría</h2>
        ${resumen.porCategoria.length ? resumen.porCategoria.map(c => `
          <div class="bar-row">
            <div class="cat-label" title="${escapeHtml(c.categoria)}">${escapeHtml(c.categoria)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${(c.monto / max * 100).toFixed(1)}%"></div></div>
            <div class="tabular">${money.format(c.monto)}</div>
          </div>
        `).join('') : '<div class="empty-state">Todavía no se cargaron gastos en este período.</div>'}
      </div>
      <div class="card">
        <h2>Por empleado</h2>
        ${resumen.porEmpleado.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Empleado</th><th>Total cargado</th></tr></thead>
            <tbody>${resumen.porEmpleado.map(e => `<tr><td>${escapeHtml(e.nombre)}</td><td class="tabular">${money.format(e.monto)}</td></tr>`).join('')}</tbody>
          </table></div>
        ` : '<div class="empty-state">Sin datos todavía.</div>'}
      </div>
    `;
  }

  function wireFiltrosResumen(container) {
    const desde = container.querySelector('#f-desde');
    const hasta = container.querySelector('#f-hasta');
    const limpiar = container.querySelector('#f-limpiar');
    desde.addEventListener('change', () => { state.filtros.desde = desde.value; renderTab(); });
    hasta.addEventListener('change', () => { state.filtros.hasta = hasta.value; renderTab(); });
    limpiar.addEventListener('click', () => {
      state.filtros.desde = ''; state.filtros.hasta = '';
      renderTab();
    });
  }

  // ---------- Tab: Gastos (lista) ----------
  async function renderGastosTab(container, opts) {
    const esEmpleado = state.user.rol === 'empleado';
    const estId = esEmpleado ? state.user.establecimientoId : state.selectedEstablecimientoId;
    if (!estId) {
      container.innerHTML = `<div class="empty-state">Todavía no hay ningún establecimiento creado.</div>`;
      return;
    }
    const params = new URLSearchParams({ establecimientoId: estId });
    if (state.filtros.desde) params.set('desde', state.filtros.desde);
    if (state.filtros.hasta) params.set('hasta', state.filtros.hasta);
    if (state.filtros.categoria) params.set('categoria', state.filtros.categoria);
    if (esEmpleado) params.set('usuarioId', state.user.id);
    const { gastos } = await api(`/api/gastos?${params}`);

    if (!opts?.silent) {
      container.innerHTML = renderGastosShell(gastos, esEmpleado);
      wireGastosFiltros(container, esEmpleado);
    } else {
      const body = container.querySelector('#gastos-body');
      if (body) body.innerHTML = renderGastosTabla(gastos);
    }
  }

  function renderGastosShell(gastos, esEmpleado) {
    return `
      <div class="card">
        <div class="card-head">
          <h2>${esEmpleado ? 'Mis gastos cargados' : 'Gastos del establecimiento'}</h2>
          <span class="pill"><span class="live-dot"></span> se actualiza solo</span>
        </div>
        <div class="filters">
          <input type="date" id="g-desde" value="${state.filtros.desde}" />
          <input type="date" id="g-hasta" value="${state.filtros.hasta}" />
          <select id="g-categoria">
            <option value="">Todas las categorías</option>
            ${state.categorias.map(c => `<option value="${escapeHtml(c)}" ${c === state.filtros.categoria ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div id="gastos-body">${renderGastosTabla(gastos)}</div>
      </div>
    `;
  }

  function renderGastosTabla(gastos) {
    if (!gastos.length) return '<div class="empty-state">No hay gastos cargados para este filtro.</div>';
    const puedeBorrar = state.user.rol === 'admin';
    return `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Empleado</th><th>Monto</th><th>Comprobante</th>${puedeBorrar ? '<th></th>' : ''}
        </tr></thead>
        <tbody>
          ${gastos.map(g => `
            <tr>
              <td class="tabular">${fmtDate(g.fecha)}</td>
              <td><span class="chip">${escapeHtml(g.categoria)}</span></td>
              <td>${escapeHtml(g.descripcion) || '<span class="helper-text">—</span>'}</td>
              <td>${escapeHtml(g.usuarioNombre)}</td>
              <td class="tabular">${moneyDec.format(g.monto)}</td>
              <td>${g.tieneComprobante
                ? `<img src="" data-gasto-id="${g.id}" class="thumb comprobante-thumb" alt="Ver comprobante" loading="lazy" />`
                : '<div class="no-thumb">—</div>'}</td>
              ${puedeBorrar ? `<td><button class="btn btn-danger btn-sm" data-borrar-gasto="${g.id}">Borrar</button></td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    `;
  }

  function wireGastosFiltros(container, esEmpleado) {
    const desde = container.querySelector('#g-desde');
    const hasta = container.querySelector('#g-hasta');
    const categoria = container.querySelector('#g-categoria');
    desde.addEventListener('change', () => { state.filtros.desde = desde.value; renderTab(); });
    hasta.addEventListener('change', () => { state.filtros.hasta = hasta.value; renderTab(); });
    categoria.addEventListener('change', () => { state.filtros.categoria = categoria.value; renderTab(); });
  }

  // Delegación para miniaturas de comprobante y borrado (la tabla se re-renderiza seguido)
  document.addEventListener('click', async (e) => {
    const thumb = e.target.closest('.comprobante-thumb');
    if (thumb) {
      try {
        const { comprobanteBase64 } = await api(`/api/gastos/${thumb.dataset.gastoId}/comprobante`);
        showLightbox(comprobanteBase64);
      } catch (err) { toast(err.message); }
      return;
    }
    const borrar = e.target.closest('[data-borrar-gasto]');
    if (borrar) {
      if (!confirm('¿Borrar este gasto? No se puede deshacer.')) return;
      try {
        await api(`/api/gastos/${borrar.dataset.borrarGasto}`, { method: 'DELETE' });
        toast('Gasto borrado');
        renderTab();
      } catch (err) { toast(err.message); }
    }
  });

  // Carga perezosa de miniaturas visibles (evita pedir todas las imágenes de una)
  const thumbObserver = 'IntersectionObserver' in window ? new IntersectionObserver(async (entries, obs) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      obs.unobserve(img);
      try {
        const { comprobanteBase64 } = await api(`/api/gastos/${img.dataset.gastoId}/comprobante`);
        img.src = comprobanteBase64;
      } catch (e) { /* silencioso */ }
    }
  }) : null;

  const mo = new MutationObserver(() => {
    document.querySelectorAll('.comprobante-thumb:not([data-observed])').forEach(img => {
      img.dataset.observed = '1';
      if (thumbObserver) thumbObserver.observe(img);
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  function showLightbox(src) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${src}" alt="Comprobante" />`;
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  }

  // ---------- Tab: Establecimientos (admin) ----------
  async function renderEstablecimientosTab(container) {
    container.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>Establecimientos / clientes</h2>
          <button class="btn btn-primary btn-sm" id="btn-nuevo-est">+ Nuevo establecimiento</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Cliente</th><th>Estado</th></tr></thead>
          <tbody>
            ${state.establecimientos.map(e => `
              <tr>
                <td>${escapeHtml(e.nombre)}</td>
                <td>${escapeHtml(e.cliente) || '<span class="helper-text">—</span>'}</td>
                <td><span class="chip">${e.activo ? 'Activo' : 'Inactivo'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
    container.querySelector('#btn-nuevo-est').addEventListener('click', () => openDialog('dlg-nuevo-establecimiento'));
  }

  // ---------- Tab: Usuarios (admin) ----------
  async function renderUsuariosTab(container) {
    const estId = state.selectedEstablecimientoId;
    const params = estId ? `?establecimientoId=${estId}` : '';
    const { usuarios } = await api(`/api/usuarios${params}`);
    container.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>Usuarios de ${escapeHtml(currentEstablecimiento()?.nombre || 'este establecimiento')}</h2>
          <button class="btn btn-primary btn-sm" id="btn-nuevo-usr" ${state.establecimientos.length ? '' : 'disabled'}>+ Nuevo usuario</button>
        </div>
        ${usuarios.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${usuarios.map(u => `
                <tr>
                  <td>${escapeHtml(u.nombreCompleto)}</td>
                  <td>${escapeHtml(u.username)}</td>
                  <td><span class="pill role-${u.rol}">${rolLabel(u.rol)}</span></td>
                  <td><span class="chip">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td><button class="btn btn-secondary btn-sm" data-toggle-usuario="${u.id}" data-activo="${u.activo}">${u.activo ? 'Desactivar' : 'Reactivar'}</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table></div>
        ` : '<div class="empty-state">Todavía no hay usuarios en este establecimiento.</div>'}
      </div>
    `;
    container.querySelector('#btn-nuevo-usr').addEventListener('click', () => openDialog('dlg-nuevo-usuario'));
    container.querySelectorAll('[data-toggle-usuario]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const activo = btn.dataset.activo === 'true';
        await api(`/api/usuarios/${btn.dataset.toggleUsuario}`, { method: 'PATCH', body: { activo: !activo } });
        renderTab();
      });
    });
  }

  // ---------- Tab: Cargar gasto (empleado) ----------
  function renderCargarTab(container) {
    container.innerHTML = `
      <div class="card">
        <h2>Cargar un gasto operativo</h2>
        <div class="helper-text" style="margin-bottom:14px">Establecimiento: ${escapeHtml(currentEstablecimiento()?.nombre || '')}</div>
        <button class="btn btn-primary" id="btn-cargar-gasto">+ Cargar gasto</button>
      </div>
      <div class="card">
        <h3>Últimos gastos cargados por vos</h3>
        <div id="mis-ultimos"></div>
      </div>
    `;
    container.querySelector('#btn-cargar-gasto').addEventListener('click', () => openDialog('dlg-nuevo-gasto'));
    cargarUltimosPropios(container);
  }

  async function cargarUltimosPropios(container) {
    const { gastos } = await api(`/api/gastos?establecimientoId=${state.user.establecimientoId}&usuarioId=${state.user.id}`);
    const el = container.querySelector('#mis-ultimos');
    if (!el) return;
    if (!gastos.length) { el.innerHTML = '<div class="empty-state">Todavía no cargaste ningún gasto.</div>'; return; }
    el.innerHTML = gastos.slice(0, 8).map(g => `
      <div class="recent-item">
        <div>
          <div>${escapeHtml(g.categoria)}${g.descripcion ? ' · ' + escapeHtml(g.descripcion) : ''}</div>
          <div class="meta">${fmtDate(g.fecha)}</div>
        </div>
        <div class="tabular">${moneyDec.format(g.monto)}</div>
      </div>
    `).join('');
  }

  // ---------- Diálogos (se cablean una sola vez) ----------
  let dialogsWired = false;
  function setupDialogsOnce() {
    if (dialogsWired) return;
    dialogsWired = true;

    document.getElementById('form-establecimiento').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('est-error');
      errEl.innerHTML = '';
      try {
        const { establecimiento } = await api('/api/establecimientos', { method: 'POST', body: { nombre: fd.get('nombre'), cliente: fd.get('cliente') } });
        state.establecimientos.push(establecimiento);
        state.selectedEstablecimientoId = establecimiento.id;
        e.target.reset();
        closeDialog('dlg-nuevo-establecimiento');
        toast('Establecimiento creado');
        renderApp();
      } catch (err) {
        errEl.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
      }
    });

    const usrEstSelect = document.getElementById('usr-establecimiento');

    document.getElementById('form-usuario').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('usr-error');
      errEl.innerHTML = '';
      try {
        await api('/api/usuarios', {
          method: 'POST',
          body: {
            establecimientoId: fd.get('establecimientoId'),
            rol: fd.get('rol'),
            nombreCompleto: fd.get('nombreCompleto'),
            username: fd.get('username'),
            password: fd.get('password')
          }
        });
        e.target.reset();
        closeDialog('dlg-nuevo-usuario');
        toast('Usuario creado');
        renderTab();
      } catch (err) {
        errEl.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
      }
    });

    // Poblar el select de establecimiento cada vez que se abre el diálogo de usuario
    new MutationObserver(() => {
      const dlg = document.getElementById('dlg-nuevo-usuario');
      if (dlg.open) {
        usrEstSelect.innerHTML = state.establecimientos.map(e => `<option value="${e.id}" ${e.id === state.selectedEstablecimientoId ? 'selected' : ''}>${escapeHtml(e.nombre)}</option>`).join('');
      }
    }).observe(document.getElementById('dlg-nuevo-usuario'), { attributes: true, attributeFilter: ['open'] });

    // Foto del gasto: preview + compresión
    let comprobanteActual = null;
    const fotoInput = document.getElementById('gasto-foto');
    const fotoPreview = document.getElementById('gasto-foto-preview');
    fotoInput.addEventListener('change', async () => {
      const file = fotoInput.files[0];
      if (!file) { comprobanteActual = null; fotoPreview.style.display = 'none'; return; }
      try {
        const dataUrl = await compressImage(file);
        comprobanteActual = dataUrl;
        fotoPreview.src = dataUrl;
        fotoPreview.style.display = 'block';
      } catch (err) {
        toast('No se pudo procesar la foto: ' + err.message);
      }
    });

    document.getElementById('dlg-nuevo-gasto').addEventListener('close', () => {
      document.getElementById('form-gasto').reset();
      comprobanteActual = null;
      fotoPreview.style.display = 'none';
      document.getElementById('gasto-error').innerHTML = '';
    });

    new MutationObserver(() => {
      const dlg = document.getElementById('dlg-nuevo-gasto');
      if (dlg.open) {
        const catSel = document.getElementById('gasto-categoria');
        if (!catSel.dataset.filled) {
          catSel.innerHTML = state.categorias.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
          catSel.dataset.filled = '1';
        }
        const fechaInput = document.getElementById('gasto-fecha');
        if (!fechaInput.value) fechaInput.value = todayIso();
      }
    }).observe(document.getElementById('dlg-nuevo-gasto'), { attributes: true, attributeFilter: ['open'] });

    document.getElementById('form-gasto').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('gasto-error');
      const btn = document.getElementById('btn-guardar-gasto');
      errEl.innerHTML = '';
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        await api('/api/gastos', {
          method: 'POST',
          body: {
            fecha: fd.get('fecha'),
            categoria: fd.get('categoria'),
            monto: fd.get('monto'),
            descripcion: fd.get('descripcion'),
            comprobanteBase64: comprobanteActual,
            comprobanteMime: comprobanteActual ? 'image/jpeg' : null
          }
        });
        closeDialog('dlg-nuevo-gasto');
        toast('Gasto cargado ✓');
        renderTab();
      } catch (err) {
        errEl.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar gasto';
      }
    });

    document.getElementById('form-password').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('pw-error');
      errEl.innerHTML = '';
      try {
        await api('/api/cambiar-password', { method: 'POST', body: { passwordActual: fd.get('passwordActual'), passwordNueva: fd.get('passwordNueva') } });
        state.user.debeCambiarPassword = false;
        e.target.reset();
        closeDialog('dlg-cambiar-password');
        toast('Contraseña actualizada');
      } catch (err) {
        errEl.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
      }
    });
  }

  init();
})();
