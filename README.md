# Gastos Agro

Sistema de carga y control de gastos operativos agropecuarios: los empleados de campo cargan cada gasto (con foto del comprobante) desde el celular, y el cliente ve en tiempo casi real en qué se está gastando. Pensado para que el estudio lo administre con varios campos/clientes al mismo tiempo.

## Qué incluye

- **Login con usuario y contraseña** para tres roles:
  - **Estudio (admin):** crea establecimientos (campos/clientes) y usuarios, ve todos los gastos.
  - **Empleado:** carga gastos de su establecimiento (fecha, categoría, monto, descripción, foto del comprobante).
  - **Cliente:** panel de solo lectura de su establecimiento — total gastado, gastos por categoría, por empleado, listado con comprobantes.
- El panel se **actualiza solo cada 8 segundos** (sin recargar la página) mientras está abierto.
- Las fotos de comprobantes se comprimen automáticamente en el celular antes de subirse.
- No depende de ninguna base de datos externa: guarda todo en un archivo (`data/db.json`), así que anda igual en un hosting en la nube o en una PC.

## Primer uso

Al arrancar por primera vez se crea un usuario administrador:

- **Usuario:** `admin`
- **Contraseña:** `admin123`

Te va a pedir cambiarla apenas entres. Desde el usuario admin creás los establecimientos (campos/clientes) y después los usuarios de tipo **empleado** y **cliente** para cada uno.

## Cómo correrlo en tu PC (para probarlo)

Necesitás tener instalado [Node.js](https://nodejs.org) (versión 18 o superior).

```bash
cd gastos-agro
npm install
npm start
```

Después abrí `http://localhost:3000` en el navegador.

## Cómo publicarlo en la nube (Render)

1. Creá una cuenta en [render.com](https://render.com) con GitHub.
2. New + → Web Service → conectá este repositorio.
3. Build command: `npm install`. Start command: `npm start`.
4. Variable de entorno `SESSION_SECRET` con un texto largo random.
5. Agregá un Disk montado en `/opt/render/project/src/data` (para que los datos no se borren en cada deploy).
6. Deploy. Te va a quedar un link tipo `https://gastos-agro.onrender.com`.

## Notas importantes

- **Contraseñas:** se guardan encriptadas (bcrypt).
- **Respaldo de datos:** todo vive en `data/db.json`. Conviene descargar una copia cada tanto.
- **Categorías de gastos:** están definidas en `categorias.js`, se pueden editar ahí.
