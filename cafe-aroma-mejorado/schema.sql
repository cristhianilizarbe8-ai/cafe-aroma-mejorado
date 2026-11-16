-- =====================================================================
--  CAFÉ AROMA · Esquema de base de datos para Supabase
--  Pégalo completo en: Supabase → SQL Editor → New query → Run
--  Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

-- ---------- 1. TABLAS ----------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  nombre           text,
  telefono         text,
  fecha_nacimiento date,
  rol              text not null default 'usuario' check (rol in ('usuario','admin')),
  creado_en        timestamptz not null default now()
);

create table if not exists public.categorias (
  id     serial primary key,
  nombre text not null unique
);

create table if not exists public.productos (
  id           bigint generated always as identity primary key,
  nombre       text not null,
  descripcion  text,
  precio       numeric(10,2) not null check (precio >= 0),
  categoria_id int references public.categorias(id) on delete set null,
  imagen_url   text,
  activo       boolean not null default true,
  nuevo        boolean not null default false,
  creado_en    timestamptz not null default now()
);

create table if not exists public.pedidos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.profiles(id) on delete cascade,
  total       numeric(10,2) not null default 0,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','preparando','entregado','cancelado')),
  direccion   text,
  metodo_pago text check (metodo_pago in ('tarjeta','yape','efectivo')),
  creado_en   timestamptz not null default now()
);

create table if not exists public.pedido_items (
  id              bigint generated always as identity primary key,
  pedido_id       bigint not null references public.pedidos(id) on delete cascade,
  producto_id     bigint references public.productos(id) on delete set null,
  nombre          text not null,                       -- copia del nombre al comprar
  cantidad        int not null check (cantidad > 0),
  precio_unitario numeric(10,2) not null
);

create table if not exists public.favoritos (
  usuario_id  uuid   not null references public.profiles(id)  on delete cascade,
  producto_id bigint not null references public.productos(id) on delete cascade,
  primary key (usuario_id, producto_id)
);

create index if not exists pedidos_usuario_idx on public.pedidos(usuario_id);
create index if not exists pedidos_creado_idx  on public.pedidos(creado_en desc);
create index if not exists items_pedido_idx    on public.pedido_items(pedido_id);

-- ---------- 2. FUNCIONES ----------
-- ¿El usuario que hace la consulta es administrador?
create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and rol = 'admin'
  );
$$;

-- Al registrarse un usuario en Auth, crea su perfil automáticamente (siempre rol 'usuario')
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, nombre, telefono, fecha_nacimiento, rol)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    new.raw_user_meta_data ->> 'telefono',
    nullif(new.raw_user_meta_data ->> 'fecha_nacimiento', '')::date,
    'usuario'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un usuario normal NO puede cambiar su propio rol
create or replace function public.proteger_rol()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.rol is distinct from old.rol
     and auth.uid() is not null
     and not public.es_admin() then
    new.rol := old.rol;
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_rol_trg on public.profiles;
create trigger proteger_rol_trg
  before update on public.profiles
  for each row execute function public.proteger_rol();

-- Crear un pedido: los precios y el total los calcula la base de datos
-- (así nadie puede manipular los precios desde el navegador).
create or replace function public.crear_pedido(
  p_items     jsonb,
  p_direccion text,
  p_metodo    text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_id    bigint;
  v_total numeric(10,2) := 0;
  it      jsonb;
  prod    record;
  v_cant  int;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para hacer un pedido';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;
  if p_metodo not in ('tarjeta','yape','efectivo') then
    raise exception 'Método de pago no válido';
  end if;
  if coalesce(length(trim(p_direccion)), 0) < 5 then
    raise exception 'Escribe una dirección válida';
  end if;

  insert into public.pedidos (usuario_id, total, direccion, metodo_pago)
  values (auth.uid(), 0, trim(p_direccion), p_metodo)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it ->> 'cantidad')::int;
    if v_cant is null or v_cant < 1 or v_cant > 50 then
      raise exception 'Cantidad no válida';
    end if;

    select id, nombre, precio into prod
      from public.productos
     where id = (it ->> 'producto_id')::bigint and activo = true;
    if not found then
      raise exception 'Un producto del carrito ya no está disponible';
    end if;

    insert into public.pedido_items (pedido_id, producto_id, nombre, cantidad, precio_unitario)
    values (v_id, prod.id, prod.nombre, v_cant, prod.precio);

    v_total := v_total + v_cant * prod.precio;
  end loop;

  update public.pedidos set total = v_total where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.crear_pedido(jsonb, text, text) from public, anon;
grant execute on function public.crear_pedido(jsonb, text, text) to authenticated;

-- ---------- 3. SEGURIDAD (Row Level Security) ----------
alter table public.profiles     enable row level security;
alter table public.categorias   enable row level security;
alter table public.productos    enable row level security;
alter table public.pedidos      enable row level security;
alter table public.pedido_items enable row level security;
alter table public.favoritos    enable row level security;

-- profiles
drop policy if exists "perfil: ver propio o admin"   on public.profiles;
drop policy if exists "perfil: editar propio"        on public.profiles;
drop policy if exists "perfil: admin edita todos"    on public.profiles;
create policy "perfil: ver propio o admin" on public.profiles
  for select using (id = auth.uid() or public.es_admin());
create policy "perfil: editar propio" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "perfil: admin edita todos" on public.profiles
  for update using (public.es_admin()) with check (public.es_admin());

-- categorias
drop policy if exists "categorias: lectura publica" on public.categorias;
drop policy if exists "categorias: admin escribe"   on public.categorias;
create policy "categorias: lectura publica" on public.categorias
  for select using (true);
create policy "categorias: admin escribe" on public.categorias
  for all using (public.es_admin()) with check (public.es_admin());

-- productos (el público solo ve los activos)
drop policy if exists "productos: lectura"       on public.productos;
drop policy if exists "productos: admin escribe" on public.productos;
create policy "productos: lectura" on public.productos
  for select using (activo = true or public.es_admin());
create policy "productos: admin escribe" on public.productos
  for all using (public.es_admin()) with check (public.es_admin());

-- pedidos (se crean SOLO con la función crear_pedido; el admin cambia el estado)
drop policy if exists "pedidos: ver propios o admin" on public.pedidos;
drop policy if exists "pedidos: admin actualiza"     on public.pedidos;
create policy "pedidos: ver propios o admin" on public.pedidos
  for select using (usuario_id = auth.uid() or public.es_admin());
create policy "pedidos: admin actualiza" on public.pedidos
  for update using (public.es_admin()) with check (public.es_admin());

-- pedido_items
drop policy if exists "items: ver propios o admin" on public.pedido_items;
create policy "items: ver propios o admin" on public.pedido_items
  for select using (
    public.es_admin()
    or exists (select 1 from public.pedidos p
               where p.id = pedido_id and p.usuario_id = auth.uid())
  );

-- favoritos
drop policy if exists "favoritos: ver propios"   on public.favoritos;
drop policy if exists "favoritos: crear propios" on public.favoritos;
drop policy if exists "favoritos: borrar propios" on public.favoritos;
create policy "favoritos: ver propios"    on public.favoritos for select using (usuario_id = auth.uid());
create policy "favoritos: crear propios"  on public.favoritos for insert with check (usuario_id = auth.uid());
create policy "favoritos: borrar propios" on public.favoritos for delete using (usuario_id = auth.uid());

-- ---------- 4. STORAGE (fotos de productos) ----------
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do nothing;

drop policy if exists "fotos: lectura publica" on storage.objects;
drop policy if exists "fotos: admin sube"      on storage.objects;
drop policy if exists "fotos: admin edita"     on storage.objects;
drop policy if exists "fotos: admin borra"     on storage.objects;
create policy "fotos: lectura publica" on storage.objects
  for select using (bucket_id = 'productos');
create policy "fotos: admin sube" on storage.objects
  for insert with check (bucket_id = 'productos' and public.es_admin());
create policy "fotos: admin edita" on storage.objects
  for update using (bucket_id = 'productos' and public.es_admin());
create policy "fotos: admin borra" on storage.objects
  for delete using (bucket_id = 'productos' and public.es_admin());

-- ---------- 5. DATOS INICIALES ----------
insert into public.categorias (nombre) values ('Clásicos'), ('Con leche')
on conflict (nombre) do nothing;

insert into public.productos (nombre, descripcion, precio, categoria_id, imagen_url, nuevo)
select v.nombre, v.descripcion, v.precio, c.id, v.imagen_url, v.nuevo
from (values
  ('Capuchino',      'Espresso con leche vaporizada y espuma cremosa.',        12, 'Con leche', 'https://images.unsplash.com/photo-1717768023941-78186ff7a5d7?auto=format&fit=crop&w=500&q=70', true),
  ('Espresso',       'Intenso y concentrado, el café en su forma pura.',        8, 'Clásicos',  'https://images.unsplash.com/photo-1777558578066-44266564ee65?auto=format&fit=crop&w=500&q=70', false),
  ('Americano',      'Espresso alargado con agua caliente, suave y limpio.',   12, 'Clásicos',  'https://images.unsplash.com/photo-1753572736794-1c6d1199aa50?auto=format&fit=crop&w=500&q=70', false),
  ('Café Ristretto', 'Dosis corta y extracción lenta: sabor profundo.',        10, 'Clásicos',  'https://images.unsplash.com/photo-1753572736770-6abc29d123d8?auto=format&fit=crop&w=500&q=70', false),
  ('Café Latte',     'Mucha leche cremosa con un toque de espresso.',          11, 'Con leche', 'https://images.unsplash.com/photo-1669603882470-48a1f6e40324?auto=format&fit=crop&w=500&q=70', false),
  ('Café Mocha',     'Espresso, chocolate y leche vaporizada.',                14, 'Con leche', 'https://images.unsplash.com/photo-1660190345473-43d3bc721c14?auto=format&fit=crop&w=500&q=70', false)
) as v(nombre, descripcion, precio, categoria, imagen_url, nuevo)
join public.categorias c on c.nombre = v.categoria
where not exists (select 1 from public.productos p where p.nombre = v.nombre);

-- =====================================================================
--  CÓMO HACER ADMINISTRADOR A TU CUENTA
--  1) Regístrate normalmente en la página con tu correo.
--  2) Ejecuta esto cambiando el correo:
--
--  update public.profiles set rol = 'admin'
--  where id = (select id from auth.users where email = 'tu-correo@gmail.com');
-- =====================================================================
