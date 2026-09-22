const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const store = require('./store');
const CATEGORIAS = require('./categorias');

const app = express();
const PORT = process.env.PORT || 3000;

// Los comprobantes viajan como imagen en base64 dentro del JSON, así que
// subimos el límite normal del body-parser de Express.
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cambiar-este-secreto-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 días
    sameSite: 'lax'
  }
}));

// ---------- Arranque / semilla ----------
function bootstrap() {
  const db = store.load();
  if (db.usuarios.length === 0) {
    const est = {
      id: store.id(),
      nombre: 'Establecimiento de ejemplo',
      cliente: 'Cliente de ejemplo',
      activo: true,
      creadoEn: new Date().toISOString()
    };
    db.establecimientos.push(est);
    db.usuarios.push({
      id: store.id(),
      username: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 10),
      rol: 'admin',
      nombreCompleto: 'Administrador del estudio',
      establecimientoId: null,
      activo: true,
      debeCambiarPassword: true
    });
    store.save();
    console.log('Usuario admin creado -> usuario: admin / contraseña: admin123 (cambiala apenas entres)');
  }
}
bootstrap();

// ---------- Utilidades ----------
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    rol: u.rol,
    nombreCompleto: u.nombreCompleto,
    establecimientoId: u.establecimientoId,
    activo: u.activo,
    debeCambiarPassword: !!u.debeCambiarPassword
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  const db = store.load();
  const user = db.usuarios.find(u => u.id === req.session.userId && u.activo);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Sesión inválida' });
  }
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    next();
  };
}

// Un usuario solo puede operar sobre su propio establecimiento, salvo el admin.
function scopedEstablecimientoId(req) {
  if (req.user.rol === 'admin') return req.query.establecimientoId || null;
  return req.user.establecimientoId;
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const db = store.load();
  const user = db.usuarios.find(u => u.username === (username || '').trim().toLowerCase());
  if (!user || !user.activo || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/cambiar-password', requireAuth, (req, res) => {
  const { passwordActual, passwordNueva } = req.body || {};
  if (!passwordNueva || passwordNueva.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  if (!bcrypt.compareSync(passwordActual || '', req.user.passwordHash)) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }
  const db = store.load();
  const user = db.usuarios.find(u => u.id === req.user.id);
  user.passwordHash = bcrypt.hashSync(passwordNueva, 10);
  user.debeCambiarPassword = false;
  store.save();
  res.json({ ok: true });
});

// ---------- Metadatos ----------
app.get('/api/categorias', requireAuth, (req, res) => {
  res.json({ categorias: CATEGORIAS });
});

// ---------- Establecimientos (solo admin gestiona; cliente/empleado ven el propio) ----------
app.get('/api/establecimientos', requireAuth, (req, res) => {
  const db = store.load();
  if (req.user.rol === 'admin') {
    return res.json({ establecimientos: db.establecimientos });
  }
  const est = db.establecimientos.find(e => e.id === req.user.establecimientoId);
  res.json({ establecimientos: est ? [est] : [] });
});

app.post('/api/establecimientos', requireAuth, requireRole('admin'), (req, res) => {
  const { nombre, cliente } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del establecimiento' });
  const db = store.load();
  const est = {
    id: store.id(),
    nombre: nombre.trim(),
    cliente: (cliente || '').trim(),
    activo: true,
    creadoEn: new Date().toISOString()
  };
  db.establecimientos.push(est);
  store.save();
  res.json({ establecimiento: est });
});

app.patch('/api/establecimientos/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db = store.load();
  const est = db.establecimientos.find(e => e.id === req.params.id);
  if (!est) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, cliente, activo } = req.body || {};
  if (nombre !== undefined) est.nombre = nombre.trim();
  if (cliente !== undefined) est.cliente = cliente.trim();
  if (activo !== undefined) est.activo = !!activo;
  store.save();
  res.json({ establecimiento: est });
});

// ---------- Usuarios (empleados y clientes) ----------
app.get('/api/usuarios', requireAuth, requireRole('admin'), (req, res) => {
  const db = store.load();
  const { establecimientoId } = req.query;
  let usuarios = db.usuarios.filter(u => u.rol !== 'admin');
  if (establecimientoId) usuarios = usuarios.filter(u => u.establecimientoId === establecimientoId);
  res.json({ usuarios: usuarios.map(publicUser) });
});

app.post('/api/usuarios', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, rol, nombreCompleto, establecimientoId } = req.body || {};
  if (!username || !password || !rol || !establecimientoId) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }
  if (!['empleado', 'cliente'].includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const db = store.load();
  const normalizedUsername = username.trim().toLowerCase();
  if (db.usuarios.some(u => u.username === normalizedUsername)) {
    return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
  }
  if (!db.establecimientos.some(e => e.id === establecimientoId)) {
    return res.status(400).json({ error: 'Establecimiento inválido' });
  }
  const nuevo = {
    id: store.id(),
    username: normalizedUsername,
    passwordHash: bcrypt.hashSync(password, 10),
    rol,
    nombreCompleto: (nombreCompleto || '').trim() || normalizedUsername,
    establecimientoId,
    activo: true,
    debeCambiarPassword: true
  };
  db.usuarios.push(nuevo);
  store.save();
  res.json({ usuario: publicUser(nuevo) });
});

app.patch('/api/usuarios/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db = store.load();
  const user = db.usuarios.find(u => u.id === req.params.id && u.rol !== 'admin');
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  const { activo, nombreCompleto, nuevaPassword } = req.body || {};
  if (activo !== undefined) user.activo = !!activo;
  if (nombreCompleto !== undefined) user.nombreCompleto = nombreCompleto.trim();
  if (nuevaPassword) {
    if (nuevaPassword.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    user.passwordHash = bcrypt.hashSync(nuevaPassword, 10);
    user.debeCambiarPassword = true;
  }
  store.save();
  res.json({ usuario: publicUser(user) });
});

// ---------- Gastos ----------
app.get('/api/gastos', requireAuth, (req, res) => {
  const db = store.load();
  const establecimientoId = scopedEstablecimientoId(req);
  let gastos = db.gastos;
  if (establecimientoId) {
    gastos = gastos.filter(g => g.establecimientoId === establecimientoId);
  } else if (req.user.rol !== 'admin') {
    gastos = [];
  }
  const { desde, hasta, categoria, usuarioId } = req.query;
  if (desde) gastos = gastos.filter(g => g.fecha >= desde);
  if (hasta) gastos = gastos.filter(g => g.fecha <= hasta);
  if (categoria) gastos = gastos.filter(g => g.categoria === categoria);
  if (usuarioId) gastos = gastos.filter(g => g.usuarioId === usuarioId);

  gastos = [...gastos].sort((a, b) => (b.creadoEn || '').localeCompare(a.creadoEn || ''));

  // A los empleados no les mandamos el comprobante en la lista (pesa), solo si piden el detalle.
  const liviano = gastos.map(g => ({ ...g, comprobanteBase64: undefined, tieneComprobante: !!g.comprobanteBase64 }));
  res.json({ gastos: liviano });
});

app.get('/api/gastos/:id/comprobante', requireAuth, (req, res) => {
  const db = store.load();
  const gasto = db.gastos.find(g => g.id === req.params.id);
  if (!gasto || !gasto.comprobanteBase64) return res.status(404).json({ error: 'No hay comprobante' });
  const establecimientoId = scopedEstablecimientoId(req);
  if (req.user.rol !== 'admin' && gasto.establecimientoId !== establecimientoId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  res.json({ comprobanteBase64: gasto.comprobanteBase64, mime: gasto.comprobanteMime });
});

app.post('/api/gastos', requireAuth, requireRole('empleado'), (req, res) => {
  const { fecha, categoria, monto, descripcion, comprobanteBase64, comprobanteMime } = req.body || {};
  if (!fecha || !categoria || monto === undefined || monto === null || monto === '') {
    return res.status(400).json({ error: 'Faltan datos obligatorios (fecha, categoría, monto)' });
  }
  const montoNum = Number(monto);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ error: 'El monto tiene que ser un número mayor a 0' });
  }
  if (!CATEGORIAS.includes(categoria)) {
    return res.status(400).json({ error: 'Categoría inválida' });
  }
  if (comprobanteBase64 && comprobanteBase64.length > 6_000_000) {
    return res.status(400).json({ error: 'La foto del comprobante es demasiado pesada' });
  }
  const db = store.load();
  const gasto = {
    id: store.id(),
    establecimientoId: req.user.establecimientoId,
    usuarioId: req.user.id,
    usuarioNombre: req.user.nombreCompleto,
    fecha,
    categoria,
    monto: montoNum,
    descripcion: (descripcion || '').trim(),
    comprobanteBase64: comprobanteBase64 || null,
    comprobanteMime: comprobanteMime || null,
    creadoEn: new Date().toISOString()
  };
  db.gastos.push(gasto);
  store.save();
  res.json({ gasto: { ...gasto, comprobanteBase64: undefined, tieneComprobante: !!gasto.comprobanteBase64 } });
});

app.delete('/api/gastos/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db = store.load();
  const idx = db.gastos.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  db.gastos.splice(idx, 1);
  store.save();
  res.json({ ok: true });
});

// ---------- Resumen para el panel del cliente / admin ----------
app.get('/api/resumen', requireAuth, (req, res) => {
  const db = store.load();
  const establecimientoId = scopedEstablecimientoId(req);
  let gastos = db.gastos;
  if (establecimientoId) {
    gastos = gastos.filter(g => g.establecimientoId === establecimientoId);
  } else if (req.user.rol !== 'admin') {
    gastos = [];
  }
  const { desde, hasta } = req.query;
  if (desde) gastos = gastos.filter(g => g.fecha >= desde);
  if (hasta) gastos = gastos.filter(g => g.fecha <= hasta);

  const total = gastos.reduce((s, g) => s + g.monto, 0);
  const porCategoria = {};
  const porEmpleado = {};
  for (const g of gastos) {
    porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto;
    porEmpleado[g.usuarioNombre] = (porEmpleado[g.usuarioNombre] || 0) + g.monto;
  }
  res.json({
    total,
    cantidadGastos: gastos.length,
    porCategoria: Object.entries(porCategoria).map(([categoria, monto]) => ({ categoria, monto })).sort((a, b) => b.monto - a.monto),
    porEmpleado: Object.entries(porEmpleado).map(([nombre, monto]) => ({ nombre, monto })).sort((a, b) => b.monto - a.monto)
  });
});

// ---------- Frontend estático ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No encontrado' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Gastos Agro corriendo en http://localhost:${PORT}`);
});
