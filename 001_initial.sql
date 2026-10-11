-- Ivy6 starter schema. Review with your security owner before production.
create extension if not exists pgcrypto;
create type public.application_status as enum ('interested','preparing','applied','assessment','interview','offer','rejected','withdrawn');
create type public.review_status as enum ('pending_review','approved','rejected');
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, preferred_roles text[] not null default '{}', preferred_location text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.saved_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  external_job_id text not null, source text not null, title text not null, company text, job_url text,
  folder text not null default 'Saved', created_at timestamptz not null default now(), unique(user_id,external_job_id,source)
);
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  external_job_id text, source text, title text not null, company text, job_url text, status public.application_status not null default 'interested',
  notes text, reminder_at timestamptz, applied_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.job_alerts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, keywords text, country text, location text, remote_only boolean not null default false,
  employment_types text[] not null default '{}', active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.cv_documents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'My CV', content jsonb not null default '{}'::jsonb, storage_path text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Career conversation', messages jsonb not null default '[]'::jsonb,
  consent_external_ai boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.employer_submissions (
  id uuid primary key default gen_random_uuid(), company text not null, contact_name text not null, email text not null,
  job_title text not null, location text not null, application_url text not null, description text not null,
  status public.review_status not null default 'pending_review', reviewer_id uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.job_reports (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
  external_job_id text not null, source text not null, reason text not null, details text,
  status public.review_status not null default 'pending_review', created_at timestamptz not null default now()
);
create table if not exists public.contact_enquiries (
  id uuid primary key default gen_random_uuid(), name text not null, email text not null, category text not null,
  subject text not null, message text not null, created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.saved_jobs enable row level security;
alter table public.applications enable row level security;
alter table public.job_alerts enable row level security;
alter table public.cv_documents enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.employer_submissions enable row level security;
alter table public.job_reports enable row level security;
alter table public.contact_enquiries enable row level security;
create policy "users manage own profile" on public.profiles for all using (auth.uid()=id) with check (auth.uid()=id);
create policy "users manage own saved jobs" on public.saved_jobs for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "users manage own applications" on public.applications for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "users manage own alerts" on public.job_alerts for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "users manage own CVs" on public.cv_documents for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "users manage own conversations" on public.ai_conversations for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
-- Employer submissions, reports and contact enquiries intentionally have no public table policies.
-- Insert them through validated server-side endpoints. Restrict staff access via server-side role checks.
