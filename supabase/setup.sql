-- Prenotazioni saloni: setup completo Supabase (v1.0)
-- Per un progetto Supabase NUOVO e vuoto (regione UE): incolla tutto nel SQL Editor ed esegui una volta.
-- In fondo ci sono blocchi commentati (automazioni) da attivare dopo.

create extension if not exists btree_gist;

create type user_role as enum ('client', 'barber', 'owner');
create type appt_status as enum ('confirmed', 'cancelled', 'completed', 'no_show');

-- ───────── Tabelle ─────────

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role user_role not null default 'client',
  created_at timestamptz not null default now()
);

create table salons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  timezone text not null default 'Europe/Rome',
  slot_step_min int not null default 30 check (slot_step_min > 0),
  cancel_cutoff_hours int not null default 2,
  active boolean not null default true
);

-- Un barbiere è una persona e può lavorare in più sedi (vedi staff_salons)
create table staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  active boolean not null default true
);

create table staff_salons (
  staff_id uuid not null references staff(id) on delete cascade,
  salon_id uuid not null references salons(id) on delete cascade,
  primary key (staff_id, salon_id)
);

create table services (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  duration_min int not null check (duration_min > 0),
  price_cents int not null check (price_cents >= 0),
  active boolean not null default true
);

create table staff_services (
  staff_id uuid references staff(id) on delete cascade,
  service_id uuid references services(id) on delete cascade,
  primary key (staff_id, service_id)
);

-- Turni per sede. Più fasce al giorno (mattina + pomeriggio). weekday: 1 = lunedì ... 7 = domenica
create table working_hours (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  salon_id uuid not null,
  weekday int not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time),
  foreign key (staff_id, salon_id) references staff_salons (staff_id, salon_id) on delete cascade
);

-- Ferie e assenze: periodo [starts_at, ends_at)
create table time_off (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);

-- Catalogo Shop (per ora solo vetrina: ordini e pagamenti non sono inclusi)
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_cents int not null check (price_cents >= 0),
  active boolean not null default true
);

-- customer_id nullo = cliente senza account (telefono, passante, prenotazione Treatwell inserita a mano)
create table appointments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id),
  staff_id uuid not null references staff(id),
  service_id uuid not null references services(id),
  customer_id uuid references profiles(id),
  guest_name text,
  guest_phone text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appt_status not null default 'confirmed',
  source text not null default 'app',  -- 'app' | 'manual' | 'treatwell'
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (customer_id is not null or guest_name is not null),
  -- niente appuntamenti sovrapposti sullo stesso barbiere, in qualsiasi sede
  exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status <> 'cancelled')
);

create index on appointments (salon_id, starts_at);
create index on appointments (customer_id, starts_at);

-- ───────── Profilo creato alla registrazione ─────────

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ───────── Funzioni di supporto ─────────

create function app_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create function my_salons() returns setof uuid
language sql stable security definer set search_path = public as $$
  select ss.salon_id
  from staff_salons ss join staff s on s.id = ss.staff_id
  where s.user_id = auth.uid()
$$;

-- ───────── Motore di disponibilità (passo slot per sede, default 30 minuti) ─────────

create function get_available_slots(
  p_salon uuid, p_service uuid, p_day date, p_staff uuid default null
) returns table (staff_id uuid, slot_start timestamptz)
language sql stable security definer set search_path = public as $$
  with svc as (
    select duration_min from services where id = p_service and active
  ), sal as (
    select timezone, slot_step_min from salons where id = p_salon and active
  ), windows as (
    select s.id as staff_id,
           (p_day + wh.start_time) at time zone sal.timezone as w_start,
           (p_day + wh.end_time)   at time zone sal.timezone as w_end
    from working_hours wh
    join staff s on s.id = wh.staff_id and s.active
    join staff_services ss on ss.staff_id = s.id and ss.service_id = p_service
    cross join sal
    where wh.salon_id = p_salon
      and wh.weekday = extract(isodow from p_day)
      and (p_staff is null or s.id = p_staff)
  ), candidates as (
    select w.staff_id,
           g.slot_start,
           g.slot_start + make_interval(mins => svc.duration_min) as slot_end
    from windows w
    cross join svc
    cross join sal
    cross join lateral generate_series(
      w.w_start,
      w.w_end - make_interval(mins => svc.duration_min),
      make_interval(mins => sal.slot_step_min)
    ) as g(slot_start)
  )
  select c.staff_id, c.slot_start
  from candidates c
  where c.slot_start > now()
    and not exists (
      select 1 from appointments a
      where a.staff_id = c.staff_id and a.status <> 'cancelled'
        and tstzrange(a.starts_at, a.ends_at) && tstzrange(c.slot_start, c.slot_end))
    and not exists (
      select 1 from time_off t
      where t.staff_id = c.staff_id and tstzrange(t.starts_at, t.ends_at) && tstzrange(c.slot_start, c.slot_end))
  order by c.slot_start, c.staff_id
$$;

-- ───────── Prenotazione e disdetta (usate dall'app cliente) ─────────

create function book_appointment(
  p_salon uuid, p_staff uuid, p_service uuid, p_start timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_dur int;
  v_tz text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;

  select duration_min into v_dur from services where id = p_service and active;
  select timezone into v_tz from salons where id = p_salon and active;
  if v_dur is null or v_tz is null then raise exception 'not_found'; end if;

  if not exists (
    select 1
    from get_available_slots(p_salon, p_service, (p_start at time zone v_tz)::date, p_staff) g
    where g.slot_start = p_start
  ) then
    raise exception 'slot_not_available';
  end if;

  insert into appointments (salon_id, staff_id, service_id, customer_id, starts_at, ends_at)
  values (p_salon, p_staff, p_service, auth.uid(), p_start, p_start + make_interval(mins => v_dur))
  returning id into v_id;

  return v_id;
exception
  when exclusion_violation then raise exception 'slot_not_available';
end $$;

create function cancel_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a appointments%rowtype;
  v_cut int;
begin
  select * into a from appointments where id = p_id;
  if not found then raise exception 'not_found'; end if;

  if a.customer_id is distinct from auth.uid()
     and app_role() is distinct from 'owner'
     and a.salon_id not in (select my_salons()) then
    raise exception 'forbidden';
  end if;

  select cancel_cutoff_hours into v_cut from salons where id = a.salon_id;
  if a.customer_id = auth.uid() and a.starts_at < now() + make_interval(hours => v_cut) then
    raise exception 'too_late_to_cancel';
  end if;

  update appointments set status = 'cancelled' where id = p_id;
end $$;

-- ───────── Permessi (Row Level Security) ─────────

alter table profiles       enable row level security;
alter table salons         enable row level security;
alter table staff          enable row level security;
alter table staff_salons   enable row level security;
alter table services       enable row level security;
alter table staff_services enable row level security;
alter table working_hours  enable row level security;
alter table time_off       enable row level security;
alter table products       enable row level security;
alter table appointments   enable row level security;

-- Catalogo leggibile da tutti, modificabile solo dal titolare
create policy "catalogo leggibile" on salons         for select using (true);
create policy "catalogo leggibile" on staff          for select using (true);
create policy "catalogo leggibile" on staff_salons   for select using (true);
create policy "catalogo leggibile" on services       for select using (true);
create policy "catalogo leggibile" on staff_services for select using (true);
create policy "catalogo leggibile" on working_hours  for select using (true);
create policy "shop leggibile"     on products       for select using (active);

create policy "titolare gestisce" on salons         for all using (app_role() = 'owner') with check (app_role() = 'owner');
create policy "titolare gestisce" on staff          for all using (app_role() = 'owner') with check (app_role() = 'owner');
create policy "titolare gestisce" on staff_salons   for all using (app_role() = 'owner') with check (app_role() = 'owner');
create policy "titolare gestisce" on services       for all using (app_role() = 'owner') with check (app_role() = 'owner');
create policy "titolare gestisce" on staff_services for all using (app_role() = 'owner') with check (app_role() = 'owner');
create policy "titolare gestisce" on working_hours  for all using (app_role() = 'owner') with check (app_role() = 'owner');
create policy "titolare gestisce" on products       for all using (app_role() = 'owner') with check (app_role() = 'owner');

-- Assenze: titolare e barbieri delle sedi in cui lavora il collega
create policy "assenze delle sedi" on time_off for all
  using (app_role() = 'owner'
         or staff_id in (select staff_id from staff_salons where salon_id in (select my_salons())))
  with check (app_role() = 'owner'
         or staff_id in (select staff_id from staff_salons where salon_id in (select my_salons())));

-- Profili: ognuno vede e modifica solo il proprio (il ruolo non è modificabile dall'utente)
create policy "profilo proprio" on profiles for select using (id = auth.uid() or app_role() = 'owner');
create policy "profilo proprio update" on profiles for update using (id = auth.uid());
revoke update on profiles from authenticated;
grant update (full_name, phone) on profiles to authenticated;

-- Appuntamenti: il cliente vede i suoi; titolare e barbieri quelli delle loro sedi.
-- I clienti prenotano e disdicono solo tramite book_appointment / cancel_appointment.
create policy "vedi appuntamenti" on appointments for select
  using (customer_id = auth.uid() or app_role() = 'owner' or salon_id in (select my_salons()));
create policy "staff inserisce" on appointments for insert
  with check (app_role() = 'owner' or salon_id in (select my_salons()));
create policy "staff aggiorna" on appointments for update
  using (app_role() = 'owner' or salon_id in (select my_salons()));

-- ───────── Dati iniziali ─────────

insert into salons (name, address) values
  ('EUR - Papillo', 'Via Alberto Moravia, 77, 00143 Roma'),
  ('Fonte Laurentina', null),
  ('Cecchignola', null);

insert into staff (name) values
  ('Luca Bartoli'), ('Lele Croce'), ('Maestro'), ('Andrea Santi'), ('Gabriele Mascia'),
  ('Ilaria Corbucci'), ('Daniele Fichera'),
  ('Flavio Marras'), ('Guglielmo Arcese'), ('Massimo Paparo'), ('Gabriele Parisi'),
  ('Claudia');

-- Giorni di lavoro per barbiere e sede (1 = lunedì ... 7 = domenica).
-- Tutti lavorano da martedì a sabato. Eccezione: Daniele Fichera, 2 giorni in sede 1 e 3 in sede 2.
create temp table _assign (staff text, salon text, days int[]);
insert into _assign values
  ('Luca Bartoli',     'EUR - Papillo',    '{2,3,4,5,6}'),
  ('Lele Croce',       'EUR - Papillo',    '{2,3,4,5,6}'),
  ('Maestro',          'EUR - Papillo',    '{2,3,4,5,6}'),
  ('Andrea Santi',     'EUR - Papillo',    '{2,3,4,5,6}'),
  ('Gabriele Mascia',  'EUR - Papillo',    '{2,3,4,5,6}'),
  ('Ilaria Corbucci',  'EUR - Papillo',    '{2,3,4,5,6}'),
  ('Daniele Fichera',  'EUR - Papillo',    '{5,6}'),
  ('Flavio Marras',    'Fonte Laurentina', '{2,3,4,5,6}'),
  ('Guglielmo Arcese', 'Fonte Laurentina', '{2,3,4,5,6}'),
  ('Massimo Paparo',   'Fonte Laurentina', '{2,3,4,5,6}'),
  ('Gabriele Parisi',  'Fonte Laurentina', '{2,3,4,5,6}'),
  ('Daniele Fichera',  'Fonte Laurentina', '{2,3,4}'),
  ('Claudia',          'Cecchignola',      '{2,3,4,5,6}');

insert into staff_salons (staff_id, salon_id)
select st.id, sa.id
from _assign a
join staff st on st.name = a.staff
join salons sa on sa.name = a.salon;

-- Primo appuntamento 10:30, ultimo taglio (30 min) alle 19:00, pausa pranzo 13:00-14:00
insert into working_hours (staff_id, salon_id, weekday, start_time, end_time)
select st.id, sa.id, u.d, t.s, t.e
from _assign a
join staff st on st.name = a.staff
join salons sa on sa.name = a.salon
cross join lateral unnest(a.days) as u(d)
cross join (values ('10:30'::time, '13:00'::time), ('14:00'::time, '19:30'::time)) as t(s, e);

drop table _assign;

insert into services (category, name, duration_min, price_cents) values
  ('Barba e capelli uomo', 'Taglio uomo',      30, 2000),
  ('Barba e capelli uomo', 'Taglio e barba',   60, 3000),
  ('Barba e capelli uomo', 'Boccia',           30, 1000),
  ('Barba e capelli uomo', 'Barba modellata',  30, 1000),
  ('Barba e capelli uomo', 'Barba con panno',  30, 1500),
  ('Barba e capelli uomo', 'Colore barba',     40, 1000),
  ('Taglio e acconciature bambini e teenager', 'Taglio bambino fino a 7 anni', 30, 1500),
  ('Trattamenti specifici per capelli', 'Meches uomo, capelli corti',  145, 5000),
  ('Trattamenti specifici per capelli', 'Meches uomo, capelli medi',   240, 7000),
  ('Trattamenti specifici per capelli', 'Meches uomo, capelli lunghi', 260, 9000);

-- Per ora ogni barbiere fa tutti i servizi: da restringere se serve
insert into staff_services select st.id, sv.id from staff st cross join services sv;

insert into products (name, price_cents) values
  ('Dopobarba in crema', 1500), ('10 in 1', 1000), ('Balsamo barba', 1500),
  ('Cera opaca', 1800), ('Cera lucida', 1800), ('Cera extra lucida', 2000),
  ('Crema attiva ricci', 1800), ('Mousse attiva ricci', 2000),
  ('Dopobarba alcolico', 1800), ('Fiale anti caduta', 5000),
  ('Gel capelli', 1800), ('Gel rasatura trasparente', 2000),
  ('Lacca per capelli', 2000), ('Olio barba', 1500), ('Polvere volumizzante', 1800),
  ('Shampoo anticaduta', 1800), ('Shampoo ad uso frequente', 1800),
  ('Shampoo anti crespo', 1800), ('Shampoo antigiallo', 1800),
  ('Shampoo per barba', 1800), ('Shampoo purificante', 1800),
  ('Shampoo seboregolatore', 1800), ('Spray al sale', 1800),
  ('Crema anti age', 3000);

-- Promemoria già inviato (evita i doppioni)
alter table appointments add column reminder_sent_at timestamptz;

-- Token dei dispositivi per le notifiche push
create table push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
alter table push_tokens enable row level security;  -- nessuna policy: si scrive solo con la funzione qui sotto

create function register_push_token(p_token text, p_platform text) returns void
language sql security definer set search_path = public as $$
  insert into push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now()
$$;

-- Titolare e barbieri vedono nome e telefono dei clienti con appuntamenti nelle proprie sedi
create policy "staff vede clienti" on profiles for select
  using (id in (select customer_id from appointments where salon_id in (select my_salons())));

-- ───────── Ruoli: dopo che titolare e barbieri si sono registrati nell'app ─────────
-- Togli i commenti e sostituisci le email.
-- update profiles set role = 'owner'  where id = (select id from auth.users where email = 'EMAIL-TITOLARE');
-- update profiles set role = 'barber' where id = (select id from auth.users where email = 'EMAIL-BARBIERE');
-- update staff set user_id = (select id from auth.users where email = 'EMAIL-BARBIERE') where name = 'Luca Bartoli';


-- ───────── Avviso al barbiere per ogni nuova prenotazione ─────────
create extension if not exists pg_net;

create function notify_new_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tokens text[];
  v_tz text;
  v_service text;
  v_client text;
begin
  if new.status <> 'confirmed' then return new; end if;

  -- token del barbiere (se usa l'app), tranne se la prenotazione l'ha inserita lui stesso
  select array_agg(pt.token) into v_tokens
  from staff s join push_tokens pt on pt.user_id = s.user_id
  where s.id = new.staff_id and s.user_id is distinct from auth.uid();
  if v_tokens is null then return new; end if;

  select timezone into v_tz from salons where id = new.salon_id;
  select name into v_service from services where id = new.service_id;
  select full_name into v_client from profiles where id = new.customer_id;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := (
      select jsonb_agg(jsonb_build_object(
        'to', tk, 'sound', 'default', 'title', 'Nuova prenotazione',
        'body', to_char(new.starts_at at time zone v_tz, 'DD/MM "alle" HH24:MI') || ', ' || v_service
                || ' (' || coalesce(v_client, new.guest_name, 'cliente') || ')'))
      from unnest(v_tokens) tk)
  );
  return new;
exception when others then
  return new;  -- un errore nelle notifiche non deve mai bloccare la prenotazione
end $$;

create trigger appointments_notify
  after insert on appointments
  for each row execute function notify_new_appointment();

-- ───────── Eliminazione account (richiesta da Apple) ─────────
-- Lo storico degli appuntamenti resta ai saloni, senza dati personali.
create function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  update appointments
     set guest_name = 'Cliente eliminato', guest_phone = null, customer_id = null
   where customer_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

-- ───────── Automazioni (da attivare dopo aver distribuito la Edge Function) ─────────
-- Sostituisci URL e segreto (lo stesso valore di CRON_SECRET), poi togli i commenti.
-- create extension if not exists pg_cron;
-- select cron.schedule('promemoria-appuntamenti', '*/15 * * * *', $$
--   select net.http_post(
--     url := 'https://IL-TUO-PROGETTO.supabase.co/functions/v1/send-reminders',
--     headers := jsonb_build_object('x-cron-secret', 'UNA-STRINGA-SEGRETA-LUNGA')
--   );
-- $$);
-- Pulizia notturna dei token non aggiornati da più di 90 giorni
-- select cron.schedule('pulizia-token', '0 4 * * *', $$
--   delete from push_tokens where updated_at < now() - interval '90 days'
-- $$);

-- ───────── Shop con acquisti online ─────────
-- Descrizione dei prodotti: la compili tu dal Table Editor (tabella products, colonna description)
alter table products add column description text;

create type order_status as enum ('pending', 'paid', 'cancelled');

-- Un ordine = un pagamento. Il ritiro avviene nella sede scelta.
create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  salon_id uuid not null references salons(id),
  status order_status not null default 'pending',
  total_cents int not null check (total_cents >= 0),
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name text not null,
  price_cents int not null,
  qty int not null check (qty > 0)
);

create index on orders (user_id, created_at desc);
create index on orders (salon_id, created_at desc);

alter table orders enable row level security;
alter table order_items enable row level security;

-- Si leggono soltanto: gli ordini li scrivono le funzioni del server (Stripe), mai l'app
create policy "vedi ordini" on orders for select
  using (user_id = auth.uid() or app_role() = 'owner' or salon_id in (select my_salons()));
create policy "vedi righe ordine" on order_items for select
  using (order_id in (select id from orders));

-- ───────── Spedizione a casa ed evasione ordini ─────────
-- Gli ordini con spedizione non hanno una sede di ritiro
alter table orders alter column salon_id drop not null;

alter table orders
  add column fulfillment text not null default 'pickup' check (fulfillment in ('pickup', 'shipping')),
  add column shipping_cents int not null default 0,
  add column shipping_name text,
  add column shipping_address jsonb,   -- compilato da Stripe dopo il pagamento
  add column customer_phone text,
  add constraint orders_destinazione check (fulfillment = 'shipping' or salon_id is not null);

-- Costi di spedizione: li modifichi dal Table Editor (tabella shop_settings), senza ripubblicare nulla.
-- Valori di PROVA: 5,00 € di spedizione, gratis sopra 60,00 €. Metti null in free_shipping_over_cents per non averla mai gratis.
create table shop_settings (
  id int primary key default 1 check (id = 1),
  shipping_cents int not null default 500 check (shipping_cents >= 0),
  free_shipping_over_cents int check (free_shipping_over_cents >= 0)
);
insert into shop_settings (shipping_cents, free_shipping_over_cents) values (500, 6000);

alter table shop_settings enable row level security;
create policy "costi spedizione leggibili" on shop_settings for select using (true);
create policy "titolare modifica costi" on shop_settings for all
  using (app_role() = 'owner') with check (app_role() = 'owner');

-- Evasione degli ordini: da evadere / evaso, e nome del cliente
alter table orders
  add column fulfillment_status text not null default 'new' check (fulfillment_status in ('new', 'done')),
  add column customer_name text;

-- Titolare e barbieri (per le loro sedi) possono solo segnare l'ordine come evaso: nessun'altra colonna è modificabile
revoke update on orders from authenticated;
grant update (fulfillment_status) on orders to authenticated;
create policy "evadi ordini" on orders for update
  using (app_role() = 'owner' or salon_id in (select my_salons()));

-- ───────── v2: foto barbieri, fedeltà, incassi ─────────
-- ───────── Foto dei barbieri ─────────
alter table staff add column photo_url text;

insert into storage.buckets (id, name, public) values ('barbers', 'barbers', true)
on conflict (id) do nothing;

create policy "foto barbieri leggibili" on storage.objects
  for select using (bucket_id = 'barbers');
create policy "titolare carica foto" on storage.objects
  for insert with check (bucket_id = 'barbers' and public.app_role() = 'owner');
create policy "titolare aggiorna foto" on storage.objects
  for update using (bucket_id = 'barbers' and public.app_role() = 'owner');

-- ───────── Carta fedeltà ─────────
-- Crediti guadagnati per ogni servizio completato: li modifichi dalla tabella services (colonna loyalty_credits).
-- Valori di PARTENZA: 10 crediti per taglio, quindi 10 tagli = 100 crediti = premio.
alter table services add column loyalty_credits int not null default 0 check (loyalty_credits >= 0);
update services set loyalty_credits = 10
where name in ('Taglio uomo', 'Taglio e barba', 'Taglio bambino fino a 7 anni');

-- Crediti necessari per il premio: li modifichi dalla tabella loyalty_settings (colonna reward_credits)
create table loyalty_settings (
  id int primary key default 1 check (id = 1),
  reward_credits int not null default 100 check (reward_credits > 0),
  reward_name text not null default 'Un taglio gratis'
);
insert into loyalty_settings default values;

create table loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  staff_id uuid references staff(id) on delete set null,
  credits int not null,                                    -- positivi = guadagnati, negativi = premio riscattato
  kind text not null check (kind in ('earn', 'redeem', 'adjust')),
  created_at timestamptz not null default now()
);
create unique index loyalty_one_earn_per_appt on loyalty_ledger (appointment_id) where kind = 'earn';
create index on loyalty_ledger (user_id, created_at desc);

create table loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  appointment_id uuid references appointments(id) on delete set null
);

-- Incasso dell'appuntamento (fotografato al momento del completamento) e premio applicato
alter table appointments
  add column price_cents int,
  add column reward_id uuid references loyalty_rewards(id) on delete set null;

-- Quando il barbiere segna "Completato": registra l'incasso e assegna i crediti al cliente.
-- Con il premio applicato l'incasso è 0 e non si guadagnano crediti.
create function on_appointment_completed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_price int; v_credits int;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select price_cents, loyalty_credits into v_price, v_credits from services where id = new.service_id;
    if new.reward_id is not null then
      new.price_cents := 0;
    else
      new.price_cents := coalesce(new.price_cents, v_price);
      if new.customer_id is not null and v_credits > 0 then
        insert into loyalty_ledger (user_id, appointment_id, staff_id, credits, kind)
        values (new.customer_id, new.id, new.staff_id, v_credits, 'earn')
        on conflict do nothing;
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger appointments_completed
  before update on appointments
  for each row execute function on_appointment_completed();

-- Il cliente riscatta il premio quando ha abbastanza crediti
create function redeem_reward() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_need int; v_bal int; v_id uuid;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  select reward_credits into v_need from loyalty_settings where id = 1;
  select coalesce(sum(credits), 0) into v_bal from loyalty_ledger where user_id = auth.uid();
  if v_bal < v_need then raise exception 'not_enough_credits'; end if;
  insert into loyalty_ledger (user_id, credits, kind) values (auth.uid(), -v_need, 'redeem');
  insert into loyalty_rewards (user_id) values (auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Il barbiere applica il premio a un appuntamento ancora da svolgere (taglio gratis)
create function apply_reward(p_appointment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments%rowtype; v_reward uuid;
begin
  select * into a from appointments where id = p_appointment;
  if not found then raise exception 'not_found'; end if;
  if app_role() is distinct from 'owner' and a.salon_id not in (select my_salons()) then
    raise exception 'forbidden';
  end if;
  if a.customer_id is null or a.status <> 'confirmed' or a.reward_id is not null then
    raise exception 'not_applicable';
  end if;
  select id into v_reward from loyalty_rewards
   where user_id = a.customer_id and used_at is null
   order by created_at limit 1 for update;
  if v_reward is null then raise exception 'no_reward'; end if;
  update loyalty_rewards set used_at = now(), appointment_id = a.id where id = v_reward;
  update appointments set reward_id = v_reward, price_cents = 0 where id = a.id;
end $$;

alter table loyalty_settings enable row level security;
alter table loyalty_ledger   enable row level security;
alter table loyalty_rewards  enable row level security;

create policy "impostazioni fedeltà leggibili" on loyalty_settings for select using (true);
create policy "titolare modifica fedeltà" on loyalty_settings for all
  using (app_role() = 'owner') with check (app_role() = 'owner');
create policy "vedi i tuoi crediti" on loyalty_ledger for select
  using (user_id = auth.uid() or app_role() = 'owner');
create policy "vedi premi" on loyalty_rewards for select
  using (user_id = auth.uid() or app_role() = 'owner'
         or user_id in (select customer_id from appointments where salon_id in (select my_salons())));

-- ───────── Control room del titolare ─────────
-- Incassi degli ultimi p_days giorni: servizi (appuntamenti "Completato"), Shop e andamento giornaliero.
create function control_room(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today timestamp := date_trunc('day', now() at time zone 'Europe/Rome');
  v_first timestamp := date_trunc('day', now() at time zone 'Europe/Rome') - make_interval(days => greatest(p_days, 1) - 1);
  v_from timestamptz := (date_trunc('day', now() at time zone 'Europe/Rome') - make_interval(days => greatest(p_days, 1) - 1)) at time zone 'Europe/Rome';
begin
  if app_role() is distinct from 'owner' then raise exception 'forbidden'; end if;
  return (
    with sv as (
      select salon_id, staff_id, price_cents, starts_at
      from appointments where status = 'completed' and starts_at >= v_from
    ),
    by_salon as (
      select s.id, s.name,
        coalesce((select sum(price_cents) from sv where sv.salon_id = s.id), 0)::int as services,
        coalesce((select count(*) from sv where sv.salon_id = s.id), 0)::int as cuts,
        coalesce((select sum(o.total_cents - o.shipping_cents) from orders o
                  where o.salon_id = s.id and o.status = 'paid' and o.created_at >= v_from), 0)::int as shop
      from salons s where s.active
    ),
    by_staff as (
      select st.id, st.name, st.photo_url,
        coalesce((select sum(price_cents) from sv where sv.staff_id = st.id), 0)::int as revenue,
        coalesce((select count(*) from sv where sv.staff_id = st.id), 0)::int as cuts
      from staff st where st.active
    ),
    by_day as (
      select d::date as day,
        coalesce((select sum(price_cents) from sv where (sv.starts_at at time zone 'Europe/Rome')::date = d::date), 0)::int as revenue
      from generate_series(v_first, v_today, interval '1 day') d
    )
    select jsonb_build_object(
      'salons', (select coalesce(jsonb_agg(to_jsonb(b) order by (b.services + b.shop) desc), '[]'::jsonb) from by_salon b),
      'staff',  (select coalesce(jsonb_agg(to_jsonb(b) order by b.revenue desc), '[]'::jsonb) from by_staff b),
      'days',   (select coalesce(jsonb_agg(to_jsonb(b) order by b.day), '[]'::jsonb) from by_day b),
      'online', (select coalesce(sum(total_cents - shipping_cents), 0)::int from orders
                 where salon_id is null and status = 'paid' and created_at >= v_from)
    )
  );
end $$;

-- ───────── Foto dei prodotti dello shop ─────────
-- Da eseguire una volta nel SQL Editor di Supabase (dopo supabase_v2.sql). Si può rilanciare senza danni.

alter table products add column if not exists image_url text;

-- Cartella pubblica per le foto: la lettura è libera, caricare e cancellare può solo il titolare
insert into storage.buckets (id, name, public) values ('products', 'products', true)
on conflict (id) do nothing;

drop policy if exists "foto prodotti leggibili" on storage.objects;
drop policy if exists "titolare carica foto prodotti" on storage.objects;
drop policy if exists "titolare aggiorna foto prodotti" on storage.objects;
drop policy if exists "titolare elimina foto prodotti" on storage.objects;

create policy "foto prodotti leggibili" on storage.objects
  for select using (bucket_id = 'products');
create policy "titolare carica foto prodotti" on storage.objects
  for insert with check (bucket_id = 'products' and public.app_role() = 'owner');
create policy "titolare aggiorna foto prodotti" on storage.objects
  for update using (bucket_id = 'products' and public.app_role() = 'owner');
create policy "titolare elimina foto prodotti" on storage.objects
  for delete using (bucket_id = 'products' and public.app_role() = 'owner');

-- Alternativa all'app: carica i file in Storage > products dalla dashboard, copia l'indirizzo pubblico del file e collegalo:
-- update products set image_url = 'https://TUO-PROGETTO.supabase.co/storage/v1/object/public/products/cera-opaca.jpg' where name = 'Cera opaca';

-- ───────── Profilo cliente, sede preferita, contatti delle sedi, calendario ─────────
-- Da eseguire una volta nel SQL Editor di Supabase (dopo supabase_v3_foto_prodotti.sql). Si può rilanciare senza danni.

-- 1) Profilo: nome e cognome separati e sede preferita
alter table profiles add column if not exists first_name text;
alter table profiles add column if not exists last_name text;
alter table profiles add column if not exists preferred_salon_id uuid references salons(id) on delete set null;

-- I profili già esistenti: la prima parola di full_name diventa il nome, il resto il cognome
update profiles
set first_name = split_part(trim(full_name), ' ', 1),
    last_name  = nullif(trim(substr(trim(full_name), length(split_part(trim(full_name), ' ', 1)) + 1)), '')
where first_name is null and full_name is not null and trim(full_name) <> '';

-- 2) Alla registrazione l'app manda nome, cognome e telefono: il profilo li salva
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first text := nullif(trim(coalesce(new.raw_user_meta_data->>'first_name', '')), '');
  v_last  text := nullif(trim(coalesce(new.raw_user_meta_data->>'last_name', '')), '');
  v_full  text := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  v_phone text := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
begin
  if v_full is null then
    v_full := nullif(trim(concat_ws(' ', v_first, v_last)), '');
  end if;
  insert into profiles (id, first_name, last_name, full_name, phone)
  values (new.id, v_first, v_last, v_full, v_phone);
  return new;
end $$;

-- Se cambiano nome o cognome, il nome completo si aggiorna da solo (resta quello mostrato nelle agende)
create or replace function sync_full_name() returns trigger
language plpgsql as $$
begin
  if new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name then
    new.full_name := nullif(trim(concat_ws(' ', new.first_name, new.last_name)), '');
  end if;
  return new;
end $$;

drop trigger if exists profiles_sync_full_name on profiles;
create trigger profiles_sync_full_name
  before update on profiles
  for each row execute function sync_full_name();

-- 3) Cosa può modificare il cliente: mai il ruolo
revoke update on profiles from authenticated;
grant update (full_name, first_name, last_name, phone, preferred_salon_id) on profiles to authenticated;

-- 4) Contatti delle sedi
alter table salons add column if not exists phone text;      -- numero per la chiamata, es. '+39 06 1234567'
alter table salons add column if not exists whatsapp text;   -- numero WhatsApp, es. '+39 333 1234567'

-- Inserisci i numeri veri (togli i commenti): oppure usa "Modifica contatti" nell'app, accedendo come titolare
-- update salons set phone = '+39 06 0000000', whatsapp = '+39 333 0000000' where name = 'EUR - Papillo';
-- update salons set phone = '+39 06 0000000', whatsapp = '+39 333 0000000' where name = 'Fonte Laurentina';
-- update salons set phone = '+39 06 0000000', whatsapp = '+39 333 0000000' where name = 'Cecchignola';

-- 5) Orari di apertura di una sede: unisce i turni dei barbieri attivi (fasce sovrapposte o attaccate diventano una sola)
create or replace function get_salon_hours(p_salon uuid)
returns table (weekday int, start_time time, end_time time)
language sql stable security definer set search_path = public as $$
  with w as (
    select wh.weekday, wh.start_time, wh.end_time
    from working_hours wh
    join staff s on s.id = wh.staff_id and s.active
    where wh.salon_id = p_salon
  ), o as (
    select w.*,
           max(w.end_time) over (
             partition by w.weekday order by w.start_time, w.end_time
             rows between unbounded preceding and 1 preceding
           ) as prev_end
    from w
  ), g as (
    select o.*,
           sum(case when o.prev_end is null or o.start_time > o.prev_end then 1 else 0 end) over (
             partition by o.weekday order by o.start_time, o.end_time
           ) as grp
    from o
  )
  select g.weekday, min(g.start_time), max(g.end_time)
  from g
  group by g.weekday, g.grp
  order by g.weekday, 2
$$;

-- 6) Calendario di prenotazione: i giorni (da p_from a p_to, al massimo 62) con almeno un orario libero
create or replace function get_available_days(
  p_salon uuid, p_service uuid, p_from date, p_to date, p_staff uuid default null
) returns table (day date)
language sql stable security definer set search_path = public as $$
  select d::date
  from generate_series(p_from::timestamp, least(p_to, p_from + 62)::timestamp, interval '1 day') d
  where exists (select 1 from get_available_slots(p_salon, p_service, d::date, p_staff))
  order by 1
$$;

-- ───────── Barbiere preferito, coordinate delle sedi, dati di contatto ─────────
-- Da eseguire una volta nel SQL Editor di Supabase (dopo supabase_v4_profilo_contatti.sql). Si può rilanciare senza danni.

-- 1) Barbiere preferito del cliente (la sede preferita c'è già dalla v4)
alter table profiles add column if not exists preferred_staff_id uuid references staff(id) on delete set null;

-- Il cliente può modificare solo questi campi, mai il ruolo
revoke update on profiles from authenticated;
grant update (full_name, first_name, last_name, phone, preferred_salon_id, preferred_staff_id) on profiles to authenticated;

-- 2) Sedi: e-mail e posizione sulla mappa
alter table salons add column if not exists email text;
alter table salons add column if not exists lat double precision;
alter table salons add column if not exists lng double precision;

-- Le coordinate si compilano da sole: quando il titolare apre "Contatti delle sedi" nell'app, la posizione
-- viene ricavata dall'indirizzo e salvata qui. Se preferisci inserirle a mano (clic destro sul punto in Google Maps,
-- si copiano le due cifre):
-- update salons set lat = 41.0000000, lng = 12.0000000 where name = 'EUR - Papillo';

-- 3) Telefoni ed e-mail dell'azienda (solo dove mancano: non sovrascrivono ciò che hai già modificato nell'app)
update salons set phone = '+39 351 729 7915' where name = 'Cecchignola' and phone is null;
update salons set phone = '+39 06 271 5453'  where name = 'Fonte Laurentina' and phone is null;
update salons set phone = '+39 06 8398 6576' where name = 'EUR - Papillo' and phone is null;
update salons set email = 'df7barber@gmail.com' where email is null;
