# Café Aroma · versión con Supabase

Tienda web con **base de datos real** y dos modos:
- **Usuario / cliente** (`index.html`): registro e inicio de sesión, catálogo, favoritos, carrito, pago, mis pedidos y perfil.
- **Administrador** (`admin.html`): acceso separado, dashboard, productos (con fotos), pedidos y usuarios.

La portada incluye accesos distintos para clientes y administradores. El panel `admin.html` comprueba el rol real `profiles.rol = 'admin'` después de autenticar; escribir una URL o seleccionar el enlace no concede permisos.

## Archivos
| Archivo | Para qué sirve |
|---|---|
| `index.html`, `style.css`, `script.js` | Tienda (modo usuario) |
| `admin.html`, `admin.css`, `admin.js` | Panel de administrador |
| `config.js` | **Aquí pegas tu URL y tu anon key de Supabase** |
| `schema.sql` | Crea tablas, seguridad, datos iniciales y el bucket de fotos |
| `img/` | (opcional) `nosotros.jpg`, `hero.jpg` |

## Puesta en marcha (10 minutos)
1. Entra a **supabase.com** → *New project* (plan gratis). Guarda la contraseña de la base de datos.
2. Abre **SQL Editor → New query**, pega TODO `schema.sql` y pulsa **Run**. Debe terminar sin errores.
3. Ve a **Project Settings → API** y copia:
   - **Project URL**
   - **anon public** key (¡nunca la `service_role`!)
   Pégalas en `config.js`.
4. (Recomendado para la demo) **Authentication → Providers → Email** → desactiva **Confirm email**, así los usuarios entran apenas se registran.
5. Abre `index.html` con **Live Server** (clic derecho → *Open with Live Server*). No lo abras con doble clic: algunos navegadores bloquean cosas desde `file://`.
6. Entra por **Usuario / cliente** para registrarte e iniciar sesión. Para el administrador, abre **Acceso administrador** o `admin.html`.
7. Regístrate primero como cliente. Luego convierte esa cuenta en administrador: en el **SQL Editor** ejecuta (cambia el correo):
   ```sql
   update public.profiles set rol = 'admin'
   where id = (select id from auth.users where email = 'tu-correo@gmail.com');
   ```
8. Cierra sesión y vuelve a entrar desde `admin.html` con el mismo correo y contraseña. Si el rol quedó actualizado, verás el dashboard. Desde la tienda también aparecerá el enlace **Panel de administrador** en el menú de cuenta.

## Cómo funciona la seguridad
- Todas las tablas tienen **Row Level Security**: aunque alguien abra la consola del navegador, la base de datos le niega lo que no le corresponde.
- El **rol** vive en `profiles.rol`. Un usuario no puede cambiárselo; solo un admin.
- Los pedidos se crean con la función `crear_pedido()`, que **calcula los precios y el total en el servidor**. Nadie puede comprar a otro precio.
- Cada usuario ve solo sus pedidos y favoritos. El admin ve todo.
- En el navegador solo va la **anon key**, que es pública por diseño. La seguridad la dan las políticas.
- Los textos que vienen de la base de datos se escapan antes de mostrarse (evita inyección de código).

## Modelo de datos
`profiles` (usuarios y rol) · `categorias` · `productos` · `pedidos` · `pedido_items` · `favoritos` · bucket `productos` (fotos).

## Problemas frecuentes
| Síntoma | Solución |
|---|---|
| Banner rojo «Falta configurar Supabase» | Pega la URL y la anon key en `config.js` |
| «Correo o contraseña incorrectos» recién registrado | Tienes activo *Confirm email*: confirma el correo o desactiva esa opción |
| El catálogo sale vacío | No corriste `schema.sql` (o no terminó sin errores) |
| «Acceso denegado» en `admin.html` | Falta el paso 7 (hacer admin a tu cuenta) |
| No suben las fotos de producto | Revisa que exista el bucket `productos` (lo crea `schema.sql`) y que seas admin |
| Cambios que no se ven | Ctrl + F5 |

## Accesos disponibles
- **Cliente:** desde `index.html`, botón **Iniciar sesión** o **Crear mi cuenta**.
- **Administrador:** desde el botón **Administrador / Acceso administrador** de la portada o directamente `admin.html`. Usa una cuenta cuyo `profiles.rol` sea `admin`.
- Un usuario normal que intente abrir `admin.html` verá la pantalla de acceso denegado.

## Nota sobre pagos y pruebas
La pantalla de pago registra el método elegido y crea el pedido en Supabase; no procesa cobros reales con tarjeta ni Yape porque eso requiere integrar una pasarela/proveedor de pagos y validar sus notificaciones en un backend seguro. Las imágenes decorativas de portada se sirven desde Unsplash y requieren conexión a internet.

## Mejora visual de la tienda
La versión actual incluye fotografías locales de estilo fotográfico para Capuchino, Espresso, Americano, Ristretto, Latte y Mocha, además de una imagen principal local. Estas imágenes se usan como respaldo si la URL guardada en `productos.imagen_url` no carga. Si el administrador sube una foto al bucket `productos`, la tienda prioriza esa foto.

Se mejoraron las tarjetas del catálogo (fotografía horizontal, mejor jerarquía de nombre/precio, botones y favoritos), las animaciones de entrada y los estados hover. El panel administrativo también tiene miniaturas más claras y microinteracciones en sus indicadores y tablas. Los movimientos respetan la preferencia del navegador `prefers-reduced-motion`.

Nota: las imágenes incluidas son recursos visuales generados para el prototipo; para representar exactamente las bebidas que vende la cafetería, reemplázalas por fotografías propias tomadas de los productos reales.


## Dashboard ampliado (versión 2.1)
El panel administrativo ahora incluye:
- Filtro de periodo: últimos 7 o 30 días.
- Pedidos del periodo, ventas confirmadas (solo pedidos entregados), ticket promedio, pendientes, productos activos y clientes registrados.
- Gráfico de ventas por día.
- Pedidos recientes.
- Distribución de pedidos por estado.
- Distribución de métodos de pago en pedidos no cancelados.
- Ranking de productos por unidades vendidas en pedidos entregados.

Los indicadores se calculan con los datos disponibles en las tablas `pedidos`, `pedido_items`, `productos` y `profiles`. El dashboard no inventa datos: cuando no hay ventas o pedidos, muestra estados vacíos o valores cero.
