-- Future cloud database (PostgreSQL, e.g. Supabase Sydney region).
-- Mirrors src/db/types.ts so the offline prototype can sync to it later.

create extension if not exists pg_trgm;   -- fuzzy search & duplicate detection

create table sites (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table households (
  id                uuid primary key,          -- generated on the device
  name              text not null,
  address           text,
  suburb            text not null,
  postcode          text,
  housing_situation text,
  notes             text,
  site              text not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  created_by text not null,        updated_by text not null,
  version    int not null default 1,
  deleted    boolean not null default false
);

create table clients (
  id                   uuid primary key,
  client_no            text not null unique,
  household_id         uuid not null references households(id),
  relationship         text not null check (relationship in ('Primary','Partner','Child','Dependent','Parent','Other relative','Other')),
  first_name           text not null,
  last_name            text not null,
  preferred_name       text,
  dob                  date not null,
  gender               text not null,
  phone                text,
  email                text,
  country_of_birth     text,
  cultural_background  text,
  languages            text,
  interpreter_needed   boolean not null default false,
  indigenous_status    text,
  income_source        text,
  concession_card      text,
  crn                  text,          -- restricted: Centrelink CRN
  medicare_no          text,          -- restricted
  licence_no           text,          -- restricted
  has_disability       boolean not null default false,
  disability_notes     text,          -- restricted: visible to permitted roles only
  consent_given        boolean not null,
  consent_date         date,
  consent_method       text check (consent_method in ('Signed on screen','Verbal','Paper form')),
  consent_signature    text,          -- PNG data URL or storage path
  privacy_acknowledged boolean not null default false,
  risk_flag            boolean not null default false,
  risk_notes           text,          -- restricted
  notes                text,
  extra                jsonb not null default '{}',  -- admin-defined custom fields
  site                 text not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  created_by text not null,        updated_by text not null,
  version    int not null default 1,  -- bumped on every change; used for conflict detection
  deleted    boolean not null default false,
  constraint consent_required check (consent_given)
);

create index clients_name_trgm on clients using gin ((first_name || ' ' || last_name) gin_trgm_ops);
create index clients_dob on clients (dob);
create index clients_household on clients (household_id);

create table services (
  id             uuid primary key,
  client_id      uuid not null references clients(id),
  household_id   uuid not null references households(id),
  batch_id       uuid,               -- shared by a whole-household entry
  date           date not null,
  type           text not null,
  support_method text not null,
  value          numeric(10,2) not null default 0,
  quantity       int not null default 1,
  notes          text,
  site           text not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  created_by text not null,        updated_by text not null,
  version    int not null default 1,
  deleted    boolean not null default false   -- "voided"; never hard-deleted
);

create index services_date on services (date);
create index services_household on services (household_id, date);

create table audit_log (
  id        uuid primary key,
  at        timestamptz not null,
  user_name text not null,
  site      text not null,
  entity    text not null,
  entity_id uuid not null,
  action    text not null check (action in ('create','update','delete')),
  changes   jsonb not null
);

create index audit_entity on audit_log (entity_id, at desc);

-- Example duplicate check the server can run after sync:
-- select id, first_name, last_name, dob,
--        similarity(first_name || ' ' || last_name, 'Jon Smyth') as name_sim
-- from clients
-- where not deleted
--   and (dob = '1984-03-12' or (first_name || ' ' || last_name) % 'Jon Smyth')
-- order by name_sim desc limit 5;

-- ---------- people, roles and settings ----------

create table staff (
  id         uuid primary key references auth.users(id),   -- Supabase Auth account (password + MFA)
  name       text not null,
  role       text not null check (role in ('Volunteer','Staff','Coordinator','Admin')),
  home_site  text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table app_config (
  id          text primary key default 'main',
  org_name    text not null,
  sites       text[] not null,
  service_types   text[] not null,
  support_methods text[] not null,
  eligibility_days int not null default 7,
  auto_lock_minutes int not null default 10,
  custom_fields jsonb not null default '[]',
  docket_footer text
);

create table service_presets (
  id text primary key, label text not null, type text not null, support_method text not null,
  value numeric(10,2) not null default 0, quantity int not null default 1, colour text, sort_order int
);

create table visit_templates (
  id text primary key, label text not null, whole_household boolean not null default true, items jsonb not null
);

-- ---------- row-level security (sketch) ----------
-- Everyone signed in can read and write clients/services; only Staff and above
-- can read restricted columns. Put restricted columns in a separate table or
-- expose clients through a view that blanks them for volunteers:
--
-- create view clients_for_volunteers as
--   select id, client_no, first_name, last_name, dob, gender, phone, household_id,
--          risk_flag, has_disability,
--          right(crn, 3) as crn_last3, right(medicare_no, 3) as medicare_last3
--   from clients where not deleted;
--
-- alter table clients enable row level security;
-- create policy staff_read on clients for select
--   using (exists (select 1 from staff s where s.id = auth.uid() and s.active and s.role <> 'Volunteer'));
