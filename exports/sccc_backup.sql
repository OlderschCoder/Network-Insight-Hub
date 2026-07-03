--
-- PostgreSQL database dump
--

\restrict dynAb4LDk6baGRSDwm8cFaUJS0vpWTGQnXs56eKC3fgfB3nRTMnG0qKHV3RH4Wi

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.strategic_objectives DROP CONSTRAINT IF EXISTS strategic_objectives_created_by_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.risks DROP CONSTRAINT IF EXISTS risks_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.reports DROP CONSTRAINT IF EXISTS reports_created_by_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.projects DROP CONSTRAINT IF EXISTS projects_created_by_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.project_assignees DROP CONSTRAINT IF EXISTS project_assignees_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.project_assignees DROP CONSTRAINT IF EXISTS project_assignees_project_id_projects_id_fk;
ALTER TABLE IF EXISTS ONLY public.processes DROP CONSTRAINT IF EXISTS processes_updated_by_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.processes DROP CONSTRAINT IF EXISTS processes_created_by_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.network_layout_positions DROP CONSTRAINT IF EXISTS network_layout_positions_updated_by_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.log_items DROP CONSTRAINT IF EXISTS log_items_weekly_entry_id_entries_id_fk;
ALTER TABLE IF EXISTS ONLY public.log_items DROP CONSTRAINT IF EXISTS log_items_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.azure_vms DROP CONSTRAINT IF EXISTS azure_vms_created_by_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.azure_resources DROP CONSTRAINT IF EXISTS azure_resources_created_by_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.ai_knowledge DROP CONSTRAINT IF EXISTS ai_knowledge_updated_by_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.after_action_reports DROP CONSTRAINT IF EXISTS after_action_reports_user_id_users_id_fk;
DROP INDEX IF EXISTS public.processes_slug_unique;
DROP INDEX IF EXISTS public.processes_category_idx;
DROP INDEX IF EXISTS public.log_items_user_week_idx;
DROP INDEX IF EXISTS public.log_items_user_date_idx;
DROP INDEX IF EXISTS public.entries_user_week_unique;
ALTER TABLE IF EXISTS ONLY public.vlans DROP CONSTRAINT IF EXISTS vlans_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_unique;
ALTER TABLE IF EXISTS ONLY public.strategic_objectives DROP CONSTRAINT IF EXISTS strategic_objectives_pkey;
ALTER TABLE IF EXISTS ONLY public.risks DROP CONSTRAINT IF EXISTS risks_pkey;
ALTER TABLE IF EXISTS ONLY public.reports DROP CONSTRAINT IF EXISTS reports_pkey;
ALTER TABLE IF EXISTS ONLY public.quotes DROP CONSTRAINT IF EXISTS quotes_pkey;
ALTER TABLE IF EXISTS ONLY public.projects DROP CONSTRAINT IF EXISTS projects_pkey;
ALTER TABLE IF EXISTS ONLY public.project_assignees DROP CONSTRAINT IF EXISTS project_assignees_project_id_user_id_pk;
ALTER TABLE IF EXISTS ONLY public.processes DROP CONSTRAINT IF EXISTS processes_pkey;
ALTER TABLE IF EXISTS ONLY public.network_switches DROP CONSTRAINT IF EXISTS network_switches_pkey;
ALTER TABLE IF EXISTS ONLY public.network_layout_positions DROP CONSTRAINT IF EXISTS network_layout_positions_pkey;
ALTER TABLE IF EXISTS ONLY public.log_items DROP CONSTRAINT IF EXISTS log_items_pkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_pkey;
ALTER TABLE IF EXISTS ONLY public.azure_vms DROP CONSTRAINT IF EXISTS azure_vms_pkey;
ALTER TABLE IF EXISTS ONLY public.azure_vms DROP CONSTRAINT IF EXISTS azure_vms_azure_resource_id_unique;
ALTER TABLE IF EXISTS ONLY public.azure_resources DROP CONSTRAINT IF EXISTS azure_resources_pkey;
ALTER TABLE IF EXISTS ONLY public.azure_resources DROP CONSTRAINT IF EXISTS azure_resources_azure_resource_id_unique;
ALTER TABLE IF EXISTS ONLY public.ai_knowledge DROP CONSTRAINT IF EXISTS ai_knowledge_pkey;
ALTER TABLE IF EXISTS ONLY public.after_action_reports DROP CONSTRAINT IF EXISTS after_action_reports_pkey;
ALTER TABLE IF EXISTS public.vlans ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.strategic_objectives ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.risks ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.reports ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.quotes ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.projects ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.processes ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.network_switches ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.log_items ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.entries ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.azure_vms ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.azure_resources ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.ai_knowledge ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.after_action_reports ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.vlans_id_seq;
DROP TABLE IF EXISTS public.vlans;
DROP SEQUENCE IF EXISTS public.users_id_seq;
DROP TABLE IF EXISTS public.users;
DROP SEQUENCE IF EXISTS public.strategic_objectives_id_seq;
DROP TABLE IF EXISTS public.strategic_objectives;
DROP SEQUENCE IF EXISTS public.risks_id_seq;
DROP TABLE IF EXISTS public.risks;
DROP SEQUENCE IF EXISTS public.reports_id_seq;
DROP TABLE IF EXISTS public.reports;
DROP SEQUENCE IF EXISTS public.quotes_id_seq;
DROP TABLE IF EXISTS public.quotes;
DROP SEQUENCE IF EXISTS public.projects_id_seq;
DROP TABLE IF EXISTS public.projects;
DROP TABLE IF EXISTS public.project_assignees;
DROP SEQUENCE IF EXISTS public.processes_id_seq;
DROP TABLE IF EXISTS public.processes;
DROP SEQUENCE IF EXISTS public.network_switches_id_seq;
DROP TABLE IF EXISTS public.network_switches;
DROP TABLE IF EXISTS public.network_layout_positions;
DROP SEQUENCE IF EXISTS public.log_items_id_seq;
DROP TABLE IF EXISTS public.log_items;
DROP SEQUENCE IF EXISTS public.entries_id_seq;
DROP TABLE IF EXISTS public.entries;
DROP SEQUENCE IF EXISTS public.azure_vms_id_seq;
DROP TABLE IF EXISTS public.azure_vms;
DROP SEQUENCE IF EXISTS public.azure_resources_id_seq;
DROP TABLE IF EXISTS public.azure_resources;
DROP SEQUENCE IF EXISTS public.ai_knowledge_id_seq;
DROP TABLE IF EXISTS public.ai_knowledge;
DROP SEQUENCE IF EXISTS public.after_action_reports_id_seq;
DROP TABLE IF EXISTS public.after_action_reports;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: after_action_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.after_action_reports (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(500) NOT NULL,
    incident text NOT NULL,
    building character varying(255),
    device_type character varying(255),
    affected_systems text,
    timeline text,
    root_cause text,
    resolution text,
    lessons_learned text,
    prevention_measures text,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    severity character varying(20) NOT NULL,
    incident_date timestamp without time zone,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    zendesk_ticket_id integer
);


--
-- Name: after_action_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.after_action_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: after_action_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.after_action_reports_id_seq OWNED BY public.after_action_reports.id;


--
-- Name: ai_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_knowledge (
    id integer NOT NULL,
    category character varying(60) DEFAULT 'general'::character varying NOT NULL,
    title character varying(300) NOT NULL,
    content text NOT NULL,
    source character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_knowledge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_knowledge_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_knowledge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_knowledge_id_seq OWNED BY public.ai_knowledge.id;


--
-- Name: azure_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.azure_resources (
    id integer NOT NULL,
    azure_resource_id character varying(512) NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    resource_group character varying(255),
    location character varying(100),
    kind character varying(255),
    sku character varying(255),
    tags json,
    subscription character varying(255),
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    source character varying(20) DEFAULT 'azure'::character varying NOT NULL,
    notes text,
    last_synced_at timestamp without time zone,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: azure_resources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.azure_resources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: azure_resources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.azure_resources_id_seq OWNED BY public.azure_resources.id;


--
-- Name: azure_vms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.azure_vms (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    resource_group character varying(255),
    subscription character varying(255),
    location character varying(100),
    size character varying(100),
    os character varying(100),
    private_ip character varying(50),
    public_ip character varying(50),
    vnet character varying(255),
    subnet character varying(255),
    status character varying(50) DEFAULT 'unknown'::character varying NOT NULL,
    purpose text,
    notes text,
    owner character varying(255),
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    azure_resource_id character varying(512),
    source character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    last_synced_at timestamp without time zone
);


--
-- Name: azure_vms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.azure_vms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: azure_vms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.azure_vms_id_seq OWNED BY public.azure_vms.id;


--
-- Name: entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entries (
    id integer NOT NULL,
    user_id integer NOT NULL,
    category character varying(50) NOT NULL,
    title character varying(500) NOT NULL,
    description text NOT NULL,
    accomplishments text,
    challenges text,
    support_needed text,
    ticket_count integer DEFAULT 0,
    week_of character varying(20) NOT NULL,
    entry_date character varying(30),
    tags json DEFAULT '[]'::json,
    is_submitted boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_items json DEFAULT '[]'::json,
    zendesk_ticket_ids json DEFAULT '[]'::json
);


--
-- Name: entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.entries_id_seq OWNED BY public.entries.id;


--
-- Name: log_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.log_items (
    id integer NOT NULL,
    user_id integer NOT NULL,
    item_date character varying(20) NOT NULL,
    week_of character varying(20) NOT NULL,
    title character varying(500) NOT NULL,
    category character varying(50) DEFAULT 'task'::character varying,
    notes text,
    weekly_entry_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: log_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.log_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: log_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.log_items_id_seq OWNED BY public.log_items.id;


--
-- Name: network_layout_positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.network_layout_positions (
    node_id character varying(255) NOT NULL,
    x real NOT NULL,
    y real NOT NULL,
    width real,
    height real,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_by integer
);


--
-- Name: network_switches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.network_switches (
    id integer NOT NULL,
    hostname character varying(255) NOT NULL,
    building character varying(255) NOT NULL,
    ip_address character varying(50) NOT NULL,
    model character varying(255),
    status character varying(20) DEFAULT 'unknown'::character varying NOT NULL,
    config_file character varying(500),
    notes text,
    location character varying(255),
    last_seen timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    maintenance_log jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: network_switches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.network_switches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: network_switches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.network_switches_id_seq OWNED BY public.network_switches.id;


--
-- Name: processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processes (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    category character varying(50) DEFAULT 'general'::character varying NOT NULL,
    summary text,
    content text DEFAULT ''::text NOT NULL,
    tags json DEFAULT '[]'::json,
    created_by integer NOT NULL,
    updated_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: processes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.processes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: processes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.processes_id_seq OWNED BY public.processes.id;


--
-- Name: project_assignees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_assignees (
    project_id integer NOT NULL,
    user_id integer NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id integer NOT NULL,
    title character varying(500) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'planning'::character varying NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    target_date character varying(20),
    new_estimated_date character varying(20),
    attachments json DEFAULT '[]'::json,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    pending_decisions json DEFAULT '[]'::json,
    strategic_objective_ids json DEFAULT '[]'::json,
    progress_log json DEFAULT '[]'::json
);


--
-- Name: projects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.projects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;


--
-- Name: quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotes (
    id integer NOT NULL,
    text text NOT NULL,
    author character varying(255),
    category character varying(50),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quotes_id_seq OWNED BY public.quotes.id;


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id integer NOT NULL,
    week_of character varying(20) NOT NULL,
    title character varying(500),
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    summary text,
    accomplishments text,
    challenges text,
    strategic_progress text,
    next_week_plans text,
    metrics json DEFAULT '{}'::json,
    contributor_count integer DEFAULT 0,
    entry_count integer DEFAULT 0,
    created_by integer,
    finalized_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    selected_item_ids json DEFAULT 'null'::json,
    custom_tasks json DEFAULT '[]'::json,
    project_ids json DEFAULT '[]'::json,
    selected_after_action_ids json DEFAULT 'null'::json,
    selected_maintenance_ids json DEFAULT 'null'::json,
    include_goal_progress boolean DEFAULT true NOT NULL,
    include_open_risks boolean DEFAULT true NOT NULL,
    email_recipients json DEFAULT '[]'::json,
    last_emailed_at timestamp without time zone,
    selected_risk_ids json DEFAULT 'null'::json
);


--
-- Name: reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reports_id_seq OWNED BY public.reports.id;


--
-- Name: risks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risks (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type character varying(20) NOT NULL,
    severity character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    title character varying(500) NOT NULL,
    description text NOT NULL,
    impact text,
    mitigation text,
    related_building character varying(255),
    related_device character varying(255),
    shared_with json DEFAULT '[]'::json,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    probability character varying(20) DEFAULT 'medium'::character varying,
    category character varying(30) DEFAULT 'other'::character varying,
    project_id integer,
    archived_at timestamp without time zone
);


--
-- Name: risks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.risks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: risks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.risks_id_seq OWNED BY public.risks.id;


--
-- Name: strategic_objectives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.strategic_objectives (
    id integer NOT NULL,
    title character varying(500) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: strategic_objectives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.strategic_objectives_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: strategic_objectives_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.strategic_objectives_id_seq OWNED BY public.strategic_objectives.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    name character varying(255) NOT NULL,
    role character varying(50) DEFAULT 'helpdesk'::character varying NOT NULL,
    department character varying(255),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    zendesk_email character varying(255),
    password_reset_token character varying(128),
    password_reset_expires timestamp without time zone,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: vlans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vlans (
    id integer NOT NULL,
    vlan_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    building character varying(255) NOT NULL,
    type character varying(20) NOT NULL,
    subnet character varying(100),
    gateway character varying(50),
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    maintenance_log jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: vlans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vlans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vlans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vlans_id_seq OWNED BY public.vlans.id;


--
-- Name: after_action_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.after_action_reports ALTER COLUMN id SET DEFAULT nextval('public.after_action_reports_id_seq'::regclass);


--
-- Name: ai_knowledge id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_knowledge ALTER COLUMN id SET DEFAULT nextval('public.ai_knowledge_id_seq'::regclass);


--
-- Name: azure_resources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.azure_resources ALTER COLUMN id SET DEFAULT nextval('public.azure_resources_id_seq'::regclass);


--
-- Name: azure_vms id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.azure_vms ALTER COLUMN id SET DEFAULT nextval('public.azure_vms_id_seq'::regclass);


--
-- Name: entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entries ALTER COLUMN id SET DEFAULT nextval('public.entries_id_seq'::regclass);


--
-- Name: log_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_items ALTER COLUMN id SET DEFAULT nextval('public.log_items_id_seq'::regclass);


--
-- Name: network_switches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.network_switches ALTER COLUMN id SET DEFAULT nextval('public.network_switches_id_seq'::regclass);


--
-- Name: processes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processes ALTER COLUMN id SET DEFAULT nextval('public.processes_id_seq'::regclass);


--
-- Name: projects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);


--
-- Name: quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes ALTER COLUMN id SET DEFAULT nextval('public.quotes_id_seq'::regclass);


--
-- Name: reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports ALTER COLUMN id SET DEFAULT nextval('public.reports_id_seq'::regclass);


--
-- Name: risks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risks ALTER COLUMN id SET DEFAULT nextval('public.risks_id_seq'::regclass);


--
-- Name: strategic_objectives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategic_objectives ALTER COLUMN id SET DEFAULT nextval('public.strategic_objectives_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: vlans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vlans ALTER COLUMN id SET DEFAULT nextval('public.vlans_id_seq'::regclass);


--
-- Data for Name: after_action_reports; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.after_action_reports (id, user_id, title, incident, building, device_type, affected_systems, timeline, root_cause, resolution, lessons_learned, prevention_measures, status, severity, incident_date, resolved_at, created_at, updated_at, zendesk_ticket_id) FROM stdin;
\.


--
-- Data for Name: ai_knowledge; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_knowledge (id, category, title, content, source, is_active, updated_by, created_at, updated_at) FROM stdin;
115	general	Using the Platform: What this app is	This is the SCCC IT Department Reporting platform. The IT team uses it to record daily/weekly work, track tasks and projects, log risks and incidents, keep network and Azure inventory, and roll everything up into weekly executive reports for the CIO. Roles: the CIO has full access (all reports, finalization, user management, projects, goals, analytics); other staff (help desk, network engineer, security engineer, staff) see their own work plus shared systems and records. When a user asks how to do something, point them to the correct page by name and give click-by-click steps.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
116	general	Using the Platform: Navigation	There is no fixed sidebar. Navigation is a command palette: click the 'Menu — search or jump to any page' button in the top header, or press Cmd/Ctrl+K, then type or click a destination. Pages are grouped into 'My Work' (Home/Dashboard, My Tasks, Weekly Log), 'Systems & Tools' (Network, Network Tools, Azure VMs, Azure Inventory, Monitoring, IT Apps, Process Library, AI Assistant), 'Reports & Records' (Risks & Issues, Post-Incident Reviews, Reports), and a CIO-only 'Leadership & Admin' group (Projects, Department Goals, Usage Analytics, Admin). The header also has 'Quick Add' and 'Ask AI' shortcuts.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
117	general	Using the Platform: Logging in and accounts	Users sign in at /login with their @sccc.edu email and password. New accounts are created via /register but stay inactive until the CIO approves them under Admin. Passwords are reset by the CIO in Admin; there is no self-service 'force change on next login' step, so users keep an assigned password until they change it themselves. If a user is deactivated, their active sessions are dropped immediately.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
118	general	Using the Platform: My Tasks and the Weekly Log	Throughout the week, staff add standalone action items on 'My Tasks' (/items) — quick title, date, category, and notes. When it's time to report, go to 'Weekly Log' (/entries) and create/generate the week's log entry; all of that week's task items are rolled into it and stamped to that weekly entry so past logs stay stable even if items are edited later. There is one weekly log per user per week. Use /entries/new to write it directly, or open a week to edit. Submitting the weekly log is what feeds the department's weekly report.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
119	general	Using the Platform: Weekly Reports (CIO)	Reports (/reports) aggregate everyone's weekly logs into one department report per week. Open a report (/reports/:id) to review it, then use the report editor to include extras for that week — Post-Incident Reviews, network maintenance windows, goal-progress snapshot, and open risks — via the selection cards. The CIO can Finalize a report (locks it), Delete it, and Export it as DOCX, XLSX, or PDF. 'Email Report' sends the PDF or DOCX to recipients over SMTP (needs SMTP settings configured). Resolved Zendesk tickets for the report's week are pulled in automatically.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
120	general	Using the Platform: Risks & Issues	Risks & Issues (/risks) tracks open risks, issues, and design suggestions. Create one at /risks/new with a type (risk/issue/design), severity, status, title, description, and mitigation. Edit at /risks/:id/edit. Open risks can be pulled into a weekly report from the report editor. Use this page for anything the team needs visibility on or a decision about.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
121	general	Using the Platform: Post-Incident Reviews	Post-Incident Reviews (/after-action, also called after-action reports) document incidents after they're resolved. Create one at /after-action/new: title, incident date, outcome, summary, timeline, what went well, what went poorly, and action items. These can be selected into the relevant week's report so leadership sees lessons learned.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
122	general	Using the Platform: Projects and Department Goals (CIO)	Projects (/projects, CIO group) track initiatives with status, percent progress, target and revised dates, assignees, attachments, a progress log, and pending decisions. Create at /projects/new, open detail at /projects/:id to log progress or record decisions. Department Goals (/strategic-objectives) hold strategic objectives/KPIs; projects can be linked to objectives, and goal progress can be snapshotted into weekly reports.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
123	general	Using the Platform: Network reference and topology	Network (/network) is the reference for switches and VLANs with search tabs, seeded from SCCC inventory. /network/visualize shows the topology diagram (React Flow); node positions are saved and shared across users (last writer wins; the CIO can reset layout). Use this to look up a switch's hostname, building, IP, model, or a VLAN's ID, subnet, and gateway.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
124	general	Using the Platform: Network Tools	Network Tools (/network/tools) is visible only to network-admin roles (CIO, network, network engineer). It has two parts: (1) FortiGate website whitelist — add a URL to the FortiGate web-filter exemption list via live API (only works when the server can reach the FortiGate, i.e. on the SCCC network/VPN); and (2) client-side PowerShell script generators (Install Printer, Add Laptop, Remove Equipment) that produce a downloadable .ps1 file to run on the target Windows machine — nothing runs on the server.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
125	general	Using the Platform: Azure VMs and Inventory	Azure VMs (/azure-vms) is the cloud VM inventory. Anyone can view; only the CIO can add/edit/delete. Click 'Sync from Azure' to pull the live VM list from the subscription — it updates existing rows, preserves manual fields (purpose, notes, owner), and flags VMs that no longer exist as deleted. Azure Inventory (/azure-inventory) shows all Azure resources grouped by type. Both require the Azure service-principal credentials to be configured.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
126	general	Using the Platform: Monitoring and IT Apps	Monitoring (/monitoring) embeds live Grafana dashboards for at-a-glance system health. IT Apps (/it-apps) is a unified embedded view of the other apps built for the IT department. Both open external tools inside the platform so users don't have to hunt for links.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
127	general	Using the Platform: Process Library	Process Library (/processes) holds runbooks and documented procedures — the team's how-to knowledge for repeatable tasks. Browse existing procedures, open one at /processes/:id, or add a new one at /processes/new. Encourage staff to document recurring fixes here so knowledge isn't lost.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
128	general	Using the Platform: AI Assistant and AI Memory	AI Assistant (/ai-report) has tabs: 'Ask AI' (chat with read access to entries, risks, post-incident reviews, and network inventory — good for summaries and questions), 'Status Report' (CIO-only executive report generation), and 'AI Memory'. AI Memory is the assistant's persistent knowledge about the SCCC environment; every active entry is loaded into the AI's context. Users can search, filter by category, add, edit, and toggle memories on/off; only the CIO can delete. The AI can also save a memory itself when a user states a durable environment fact or says 'remember this' — a toast confirms what was saved. Never store passwords or secrets in AI Memory; the system blocks credential-like content.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
129	general	Using the Platform: Admin and Usage Analytics (CIO)	Admin (/admin, CIO only) manages users: approve/activate new registrations, change roles, reset passwords, and deactivate accounts. Usage Analytics (/analytics, CIO only) shows platform usage insights. These are the CIO's control surfaces for access and adoption.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
130	general	Using the Platform: Typical weekly workflow	Recommended rhythm for a staff member: (1) add action items to My Tasks as work happens during the week; (2) log risks/issues and write Post-Incident Reviews for any incidents; (3) near end of week, open Weekly Log and generate/submit the week's entry (task items roll in automatically). For the CIO: (4) open the week's Report, select the extras to include (post-incident reviews, maintenance, goal progress, open risks), review, then Finalize and Export or Email it. Use the AI Assistant to draft summaries or answer questions about the data at any point.	seed	t	\N	2026-07-03 04:22:13.822931	2026-07-03 04:22:13.822931
60	applications	Zoom	Known SCCC Zoom context:\r\n\r\nVanity URL:\r\nhttps://sccc.zoom.us\r\n\r\nTypical SAML settings have included:\r\n\r\nIdentifier:\r\nhttps://sccc.zoom.us\r\n\r\nReply URL:\r\nhttps://sccc.zoom.us/saml/SSO\r\n\r\nSign-on URL:\r\nhttps://sccc.zoom.us\r\n\r\nCommon issues:\r\n\r\nSecond login prompt\r\nSSO succeeds but opens the wrong page\r\nIncorrect NameID\r\nCertificate mismatch\r\nIncorrect issuer\r\nApplication not assigned\r\nOld QuickLaunch redirection\r\nBrowser session retaining old federation data	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
47	helpdesk	Purpose and Scope	Purpose\r\n\r\nThis document provides institutional, technical, operational, and response-style context for an AI assistant supporting the Seward County Community College Information Technology Helpdesk.\r\n\r\nThe assistant should provide accurate, practical, environment-specific guidance. It should not give generic enterprise IT advice when an SCCC-specific answer is possible.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
48	organization	Organization	Organization:\r\nSeward County Community College, commonly abbreviated SCCC.\r\n\r\nPrimary domain:\r\nsccc.edu\r\n\r\nPrimary IT support contacts:\r\nEmail: [itech@sccc.edu](mailto:itech@sccc.edu)\r\nPhone: 620-417-1200\r\n\r\nPrimary IT leadership and staff:\r\n\r\nDr. Mark Bojeun\r\nChief Information Officer\r\nResponsible for technology strategy, infrastructure, cybersecurity, cloud, identity, applications, modernization, vendor management, and IT operations.\r\n\r\nLucas Gonzales\r\nNetwork and Security Analyst\r\n\r\nTracy Compaan\r\nHelp Desk Manager\r\n\r\nIllia Ivanov\r\nTechnical Support\r\n\r\nMaria Salas\r\nTechnical Support and Administrative Assistant\r\n\r\nThe assistant should not invent personnel, roles, approval authority, passwords, IP addresses, system names, or technical configurations.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
49	helpdesk	Helpdesk Response Expectations	Answers should:\r\n\r\n1. Directly address the reported problem.\r\n2. Use SCCC systems, architecture, and terminology.\r\n3. Give clear diagnostic steps in the correct order.\r\n4. Separate diagnostic commands from corrective actions.\r\n5. Explain the expected result of each important test.\r\n6. Avoid unnecessary theory unless it helps resolve the issue.\r\n7. Avoid recommending broad environmental changes before confirming the cause.\r\n8. Warn before actions that could interrupt authentication, networking, production systems, or user access.\r\n9. Prefer reversible changes and document rollback procedures.\r\n10. Ask for command output, screenshots, logs, or exact error messages when the evidence is insufficient.\r\n11. Never fabricate a successful result.\r\n12. State uncertainty clearly when a conclusion has not been verified.\r\n13. Provide complete commands, scripts, or configuration examples rather than fragments.\r\n14. Assume Windows 11 for endpoint support unless another operating system is identified.\r\n15. For network issues, capture the building, room, device, switch, port, VLAN, IP address, gateway, DNS servers, and connection type.\r\n16. For account issues, identify whether the affected account is a student, faculty member, staff member, administrator, service account, or vendor account.\r\n17. For SSO issues, determine whether failure occurs at Entra, the application, the SAML/OIDC configuration, Conditional Access, MFA, DNS, or the application session.\r\n18. Do not recommend bypassing MFA, Conditional Access, security controls, or approved administrative processes.\r\n\r\nPreferred ticket response format:\r\n\r\nProblem summary:\r\nTwo or three sentences explaining the reported issue and likely scope.\r\n\r\nLikely cause:\r\nThe most probable cause based on the available evidence.\r\n\r\nDiagnostic steps:\r\nOrdered tests that isolate the problem.\r\n\r\nResolution:\r\nSpecific corrective actions.\r\n\r\nValidation:\r\nHow to confirm that the issue is resolved.\r\n\r\nEscalation:\r\nWhat information must be collected before escalating.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
50	environment	Core SCCC Technology Environment	SCCC operates a hybrid enterprise environment that includes:\r\n\r\nMicrosoft Azure\r\nMicrosoft Entra ID\r\nOn-premises Active Directory\r\nMicrosoft 365\r\nAzure virtual machines\r\nAzure private virtual networks\r\nAzure VPN Gateway\r\nAzure Bastion\r\nFortinet FortiGate firewalls\r\nAruba enterprise switches\r\nAruba wireless access points\r\nAruba Mobility infrastructure\r\nCisco Nexus switching in selected areas\r\nGrafana\r\nInfluxDB 2.x\r\nTelegraf\r\nDocker and Docker Compose\r\nCanvas LMS\r\nEllucian Banner SaaS\r\nEllucian Experience, also called My Saints\r\nEthos APIs\r\nZendesk\r\nWebex\r\nZoom\r\nPower BI Gateway\r\nWindows Server\r\nWindows 11 endpoints\r\nLinux servers and appliances	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
51	network	Network Environment	Campus scope:\r\n\r\nApproximately 21 buildings\r\nInstructional facilities\r\nAdministrative areas\r\nStudent housing\r\nAthletics\r\nPublic and guest wireless\r\nAdult Learning Center\r\nWest Campus\r\nTruck-driving facilities\r\nRemote and specialized facilities\r\n\r\nThe campus backbone has been modernized from legacy infrastructure to high-capacity fiber.\r\n\r\nRelevant capacity context:\r\n\r\nCampus fiber backbone supports up to 25 Gb connectivity in parts of the environment.\r\nMain-campus Internet or WAN capacity has included 10 Gb service.\r\nWest Campus has a newer 5 Gb ISP service.\r\nOlder West Campus service was approximately 1 Gb.\r\nAll West Campus traffic may be routed through an IPsec tunnel to the main-campus FortiGate, including Internet traffic.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
52	network	Switching	Primary modern switching platform:\r\nArubaOS-CX\r\n\r\nCommon models include:\r\nAruba 6300\r\nAruba 6100\r\n\r\nSome Cisco Nexus equipment remains in the environment.\r\n\r\nAruba switches may use:\r\n\r\nVSF\r\nVLAN trunks\r\nNative VLANs\r\nTagged VLANs\r\nAccess VLANs\r\nSFP and SFP+ optics\r\n10 Gb fiber links\r\nSNMPv3\r\nLLDP\r\nStatic and dynamic routing\r\nFortiGate uplinks\r\n\r\nImportant switching guidance:\r\n\r\nNever assume the native VLAN is correct merely because the interface is up.\r\nVerify both ends of a trunk.\r\nConfirm the allowed VLAN list on every upstream link.\r\nCheck for native VLAN mismatches.\r\nCheck spanning-tree state.\r\nCheck MAC address learning.\r\nCheck ARP resolution.\r\nCheck link speed, duplex, optics, and transceiver compatibility.\r\nCheck interface error counters.\r\nConfirm whether a VLAN should be tagged or untagged.\r\nDo not change a production trunk without documenting its current configuration.\r\n\r\nCommon ArubaOS-CX commands include:\r\n\r\nshow interface brief\r\nshow interface 1/1/x\r\nshow running-config interface 1/1/x\r\nshow vlan\r\nshow vlan port 1/1/x\r\nshow mac-address-table\r\nshow arp\r\nshow lldp neighbor-info\r\nshow spanning-tree\r\nshow ip route\r\nshow interface transceiver\r\nshow logging\r\nshow system\r\n\r\nConfiguration syntax must be validated for the switch model and ArubaOS-CX version before use.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
53	network	Wireless	SCCC uses Aruba enterprise wireless infrastructure.\r\n\r\nCommon AP models include:\r\n\r\nAruba 635\r\nAruba 575 outdoor APs\r\n\r\nWireless environments include:\r\n\r\nsccc_wireless\r\nsccc_guest\r\n\r\nCommon symptoms include:\r\n\r\nConnected but no Internet\r\nUnable to obtain an IP address\r\n169.254.x.x APIPA address\r\nSSID visible but authentication fails\r\nGuest network works while secured network fails\r\nPoor throughput\r\nWeak signal\r\nVLAN not carried to the AP\r\nDHCP unavailable on the wireless VLAN\r\nIncorrect native VLAN on the AP switch port\r\nSSID-to-VLAN mapping errors\r\nController or AP-group configuration errors\r\n\r\nWireless troubleshooting order:\r\n\r\n1. Confirm the AP is online in the Aruba management platform.\r\n2. Identify the AP name, group, building, and switch port.\r\n3. Check the AP switch-port configuration.\r\n4. Confirm the expected native and allowed VLANs.\r\n5. Confirm the VLAN reaches the DHCP server or relay.\r\n6. Verify that the client receives a valid IP address.\r\n7. Verify gateway, DNS, and Internet reachability.\r\n8. Test both the secure and guest SSIDs.\r\n9. Check authentication logs for the secured SSID.\r\n10. Review RF conditions, channel use, signal strength, interference, and client capabilities only after VLAN and DHCP issues are excluded.\r\n\r\nA client address beginning with 169.254 usually means DHCP failed. It does not normally indicate an Internet bandwidth problem.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
54	network	Fortigate	FortiGate firewalls support:\r\n\r\nCampus Internet access\r\nInter-VLAN routing in portions of the environment\r\nSite-to-site VPN\r\nIPsec tunnels\r\nSecurity inspection\r\nFirewall policies\r\nNAT\r\nAPI-based monitoring\r\nConnectivity between Azure and campus networks\r\n\r\nCommon troubleshooting areas:\r\n\r\nIPsec phase 1 and phase 2\r\nTraffic selectors\r\nStatic routes\r\nPolicy routes\r\nFirewall policies\r\nNAT configuration\r\nAddress objects\r\nInterface status\r\nVPN tunnel state\r\nRouting table\r\nPacket capture\r\nSession table\r\nSecurity profiles\r\n\r\nCommon FortiGate diagnostics include:\r\n\r\nget system status\r\nget router info routing-table all\r\nget vpn ipsec tunnel summary\r\ndiagnose vpn tunnel list\r\ndiagnose sys session list\r\ndiagnose sniffer packet any\r\ndiagnose debug flow\r\n\r\nDebugging must be used carefully and disabled after testing.\r\n\r\nA tunnel showing “connected” does not prove that traffic is correctly routed. Validate both directions using routing tables, policies, selectors, packet captures, and endpoint tests.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
55	azure	Azure Environment	SCCC uses Azure for infrastructure modernization and privately hosted systems.\r\n\r\nRelevant services include:\r\n\r\nAzure virtual machines\r\nAzure virtual networks\r\nPrivate subnets\r\nGatewaySubnet\r\nAzure VPN Gateway\r\nLocal Network Gateway\r\nSite-to-site VPN\r\nAzure Bastion\r\nNetwork Security Groups\r\nApplication Gateway\r\nWeb Application Firewall\r\nAzure Monitor\r\nLog Analytics\r\nApplication Insights\r\nAzure Key Vault\r\nMicrosoft Entra ID\r\nAzure-hosted Linux and Windows servers\r\n\r\nAzure systems should generally avoid direct public exposure unless specifically designed as a public service.\r\n\r\nPreferred administrative access:\r\n\r\nAzure Bastion\r\nPrivate network access\r\nSite-to-site VPN\r\nControlled administrative endpoints\r\n\r\nAzure virtual-machine troubleshooting should include:\r\n\r\nVM power state\r\nBoot diagnostics\r\nGuest operating-system health\r\nNetwork interface\r\nEffective routes\r\nNetwork Security Groups\r\nPrivate IP address\r\nDNS configuration\r\nDisk state\r\nExtension state\r\nAzure activity log\r\nSerial console where applicable\r\n\r\nWhen duplicating an Azure VM, confirm whether the requirement is:\r\n\r\nA full clone\r\nA new VM from a managed image\r\nA VM created from a snapshot\r\nA VM created from Azure Compute Gallery\r\nA temporary copy for testing\r\nA production replacement\r\n\r\nA copied operating-system disk alone does not automatically recreate every VM setting. Validate:\r\n\r\nVM size\r\nNetwork interface\r\nSubnet\r\nNSG\r\nAvailability settings\r\nManaged identity\r\nData disks\r\nExtensions\r\nBoot diagnostics\r\nTags\r\nBackup configuration\r\nMonitoring\r\nLicensing\r\nDNS registration\r\nComputer name\r\nDomain membership	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
56	identity	Identity and Access Management	SCCC is transitioning from QuickLaunch-based federation to Microsoft Entra ID.\r\n\r\nTarget identity direction:\r\n\r\nMicrosoft Entra ID is the primary authentication and SSO platform.\r\nMicrosoft Authenticator supports MFA.\r\nConditional Access controls access.\r\nPassword Hash Synchronization supports cloud authentication.\r\nOn-premises Active Directory remains for legacy systems and services where necessary.\r\nQuickLaunch is being removed or reduced as dependencies are eliminated.\r\n\r\nHistorical identity configuration has included:\r\n\r\nOn-premises Active Directory forest and domain using sccc.edu\r\nMultiple domain controllers\r\nMicrosoft Entra Connect or Cloud Sync\r\nPassword Hash Synchronization\r\nPass-through Authentication\r\nSeamless SSO\r\nFederation through QuickLaunch\r\n\r\nIdentity changes can affect the entire college. The assistant must not advise disabling federation, PTA, sync, DNS, or authentication agents without confirming the migration stage and rollback plan.\r\n\r\nImportant identity principles:\r\n\r\nDo not disable Pass-through Authentication before confirming Password Hash Synchronization is healthy.\r\nDo not convert a domain from federated to managed without validating all dependent applications.\r\nDo not remove QuickLaunch until all required integrations have been migrated.\r\nDo not assume a successful Entra test proves every user population is ready.\r\nValidate staff, faculty, student, administrator, and service-account scenarios separately.\r\nCheck synchronization status before resetting or recreating accounts.\r\nAccount changes may require synchronization time before appearing in Entra or connected applications.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
57	identity	MFA Policy Context	Faculty and staff:\r\n\r\nMicrosoft Authenticator is used during registration.\r\nApproved recovery methods may include verified phone or alternate email, depending on policy.\r\n\r\nStudents:\r\n\r\nMicrosoft Authenticator is the primary required MFA method.\r\nText, voice call, or email codes may not be permitted as substitutes for Authenticator.\r\n\r\nDo not advise users to remove or bypass MFA unless directed by an authorized SCCC administrator.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
58	identity	Common Entra Troubleshooting	Check:\r\n\r\nUser exists in on-premises AD\r\nUser exists in Entra\r\nUPN is correct\r\nPrimary email address is correct\r\nProxyAddresses are correct\r\nAccount is enabled\r\nPassword synchronization completed\r\nAuthentication method registration\r\nMFA registration status\r\nConditional Access result\r\nSign-in logs\r\nEnterprise application assignment\r\nSAML or OIDC claims\r\nGroup membership\r\nLicense assignment\r\nProvisioning logs\r\nApplication-specific user status\r\n\r\nUseful evidence includes:\r\n\r\nExact sign-in error\r\nCorrelation ID\r\nRequest ID\r\nTimestamp\r\nApplication name\r\nUser principal name\r\nDevice\r\nBrowser\r\nLocation\r\nConditional Access result\r\nAuthentication requirement\r\nFailure reason	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
59	identity	SSO and Enterprise Applications	SCCC applications using or transitioning to Entra SSO include:\r\n\r\nCanvas\r\nZoom\r\nCisco Webex\r\nEllucian Experience\r\nMicrosoft 365\r\nOther SaaS applications\r\n\r\nCommon SSO protocols:\r\n\r\nSAML 2.0\r\nOpenID Connect\r\nOAuth 2.0\r\n\r\nFor SAML troubleshooting, validate:\r\n\r\nEntity ID or Identifier\r\nReply URL or Assertion Consumer Service URL\r\nSign-on URL\r\nLogout URL where applicable\r\nNameID format\r\nNameID source\r\nUser claims\r\nSigning certificate\r\nCertificate expiration\r\nMetadata\r\nIssuer\r\nAudience\r\nClock synchronization\r\nApplication-side SSO settings\r\n\r\nAn expired inactive certificate may not affect production if a different active signing certificate is in use. Confirm which certificate is active before deleting or replacing anything.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
61	applications	Webex	Webex SSO has been migrated or configured through Microsoft Entra.\r\n\r\nCommon errors have included:\r\n\r\nOnly POST request is supported\r\nDestination ID not trusted\r\nControl Hub redirects to QuickLaunch\r\nTest SSO works but direct login fails\r\nIncognito session produces different behavior\r\n\r\nTroubleshooting should compare:\r\n\r\nControl Hub IdP configuration\r\nEntra metadata\r\nIssuer\r\nDestination\r\nACS URL\r\nBinding type\r\nCertificate\r\nApplication assignment\r\nBrowser cookies\r\nOld federation references	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
62	applications	Canvas	Canvas is a mission-critical SaaS platform, but SCCC does not assume that Canvas is always available or secure.\r\n\r\nFollowing a Canvas security incident, SCCC disconnected or restricted Canvas integrations until security was verified.\r\n\r\nSecurity review areas include:\r\n\r\nSAML configuration\r\nEntra enterprise application\r\nDeveloper keys\r\nPersonal access tokens\r\nLTI secrets\r\nLTI 1.3 configuration\r\nWebhook secrets\r\nSIS credentials\r\nAPI credentials\r\nUser access\r\nAudit logs\r\nEmail and IdP logs\r\nPotential phishing and social engineering\r\n\r\nDo not reconnect or reauthorize Canvas integrations solely because the primary Canvas website is available.\r\n\r\nCanvas access guidance:\r\n\r\nWhen students have trouble using an app or saved shortcut, they may be instructed to access the web version through sccc.edu.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
63	applications	Academic Continuity Repository	SCCC developed an Academic Continuity Repository, abbreviated ACR.\r\n\r\nPurpose:\r\n\r\nMaintain read-only snapshots of critical Canvas LMS and Banner SIS data so faculty and administrators retain access during a SaaS outage.\r\n\r\nThe ACR is not a replacement LMS or student information system.\r\n\r\nIt provides continuity access to selected information such as:\r\n\r\nCourse sections\r\nClass rosters\r\nAssignments\r\nGrade snapshots\r\nStudent information required for continuity\r\nSync status\r\nPrintable continuity packets\r\nAudit logs\r\nOutage status\r\n\r\nThe architecture uses API-based synchronization and may use daily or scheduled delta synchronization.\r\n\r\nSecurity requirements include:\r\n\r\nSSO integration\r\nRead-only access where appropriate\r\nRole-based authorization\r\nAudit logging\r\nPrivate hosting\r\nControlled administrative access\r\nSecure credential storage\r\nMinimal exposure of student information\r\nFERPA-aligned handling	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
64	applications	Ellucian and Banner	SCCC uses Ellucian Banner SaaS and Ellucian Experience.\r\n\r\nKnown Experience URL:\r\nhttps://experience.elluciancloud.com/scccats/\r\n\r\nRelated systems include:\r\n\r\nEthos APIs\r\nEUP or user-provisioning processes\r\nBanner student data\r\nAccount provisioning\r\nMicrosoft Entra\r\nActive Directory\r\n\r\nStudent provisioning may involve:\r\n\r\nCreating the student identity\r\nWriting identity information to Active Directory or Entra\r\nReturning account information to Banner\r\nMaintaining identifiers such as UDCID\r\nUsing an extension attribute for institutional identifiers\r\n\r\nA previous identity design moved UDCID data from the AD comment field to extensionAttribute1.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
65	applications	Microsoft 365	Common SCCC Microsoft 365 support areas include:\r\n\r\nOffice portal access\r\nOutlook\r\nExchange Online\r\nOneDrive\r\nTeams\r\nPassword reset\r\nMFA registration\r\nLicensing\r\nShared mailboxes\r\nEmail signatures\r\nSecurity warnings\r\nExternal sender identification\r\n\r\nInterim Microsoft 365 access may use:\r\nhttps://www.office.com\r\n\r\nEmail security guidance:\r\n\r\nMessages containing external links or attachments may display an external-sender warning.\r\nDo not assume an email is legitimate because the display name matches an SCCC employee.\r\nVerify the sender domain and actual email address.\r\nEscalate suspected phishing.\r\nDo not open unexpected attachments or authentication links.\r\nDo not send passwords or MFA codes by email.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
66	endpoints	Powershell and Active Directory	Common AD troubleshooting should include:\r\n\r\nwhoami\r\nwhoami /groups\r\nGet-ADUser\r\nGet-ADGroupMember\r\nGet-ADPrincipalGroupMembership\r\ngpresult\r\nklist\r\nnltest\r\nTest-ComputerSecureChannel\r\nGet-SmbConnection\r\nnet use\r\nResolve-DnsName\r\nnslookup\r\nTest-NetConnection\r\n\r\nWhen PowerShell modules are required, state the prerequisite and installation command.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
67	endpoints	File Share Issues	A common Windows file-share error is:\r\n\r\nSystem error 1219\r\n\r\nMeaning:\r\n\r\nWindows already has a connection to the same server using different credentials.\r\n\r\nResolution sequence:\r\n\r\n1. Save open work.\r\n2. Display active SMB connections.\r\n3. Remove conflicting drive mappings or SMB sessions.\r\n4. Clear stored credentials if necessary.\r\n5. Sign out and back in when sessions cannot be cleanly removed.\r\n6. Reconnect using the correct SCCC account.\r\n7. Confirm group membership and share permissions.\r\n8. Verify both share-level and NTFS permissions.\r\n\r\nUseful commands:\r\n\r\nnet use\r\nnet use * /delete\r\nGet-SmbConnection\r\nGet-SmbMapping\r\nRemove-SmbMapping\r\ncmdkey /list\r\ncmdkey /delete\r\n\r\nDo not immediately change folder permissions when the error indicates a credential-session conflict.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
68	network	DNS	SCCC uses internal and public DNS.\r\n\r\nImportant design direction:\r\n\r\nPublic sccc.edu records should resolve through authoritative public DNS.\r\nInternal DNS should host only required internal resources or delegated internal namespaces.\r\nAvoid creating unnecessary internal copies of public zones.\r\nAvoid conditional forwarders that cause public sccc.edu lookups to fail internally.\r\nAzure private resources may use Azure Private DNS and Azure Private Resolver.\r\n\r\nDNS troubleshooting should test:\r\n\r\nConfigured client DNS servers\r\nForward lookup\r\nReverse lookup\r\nSOA record\r\nNS records\r\nPublic resolver result\r\nInternal resolver result\r\nConditional forwarders\r\nZone existence\r\nDelegation\r\nFirewall access to UDP and TCP port 53\r\nDNS service health\r\n\r\nUseful commands:\r\n\r\nipconfig /all\r\nipconfig /flushdns\r\nResolve-DnsName\r\nnslookup\r\nnslookup -type=soa sccc.edu\r\nnslookup -type=ns sccc.edu\r\nTest-NetConnection -Port 53\r\nGet-DnsClientServerAddress	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
69	monitoring	Monitoring Platform	SCCC operates a centralized Network Operations Dashboard.\r\n\r\nHosting:\r\n\r\nAzure Linux VM\r\nPrivate Azure VNet\r\nDocker\r\nDocker Compose\r\nGrafana\r\n\r\nCore components:\r\n\r\nGrafana\r\nInfluxDB 2.x\r\nTelegraf\r\nSNMPv3\r\nICMP\r\nSyslog\r\nFlux\r\nFortiGate API\r\nArubaOS-CX SNMP\r\nCisco SNMP\r\nLinux and Docker monitoring\r\n\r\nMonitored systems include:\r\n\r\nAruba switches\r\nCisco Nexus switches\r\nFortiGate firewalls\r\nWireless infrastructure\r\nUPS systems\r\nBuildings\r\nISP and WAN links\r\nSite-to-site VPN\r\nAzure services\r\nLinux servers\r\nDocker containers\r\n\r\nCommon dashboard information:\r\n\r\nDevice status\r\nDevice counts\r\nLast-seen time\r\nStale devices\r\nOffline devices\r\nFirewall CPU\r\nFirewall memory\r\nSession counts\r\nWAN utilization\r\nTunnel latency\r\nPacket loss\r\nInternet throughput\r\nInterface utilization\r\nBroadcast packets\r\nMulticast packets\r\nBuilding availability\r\nOutage status\r\nHistorical trends\r\n\r\nAlerting requirement:\r\n\r\nA switch outage should generate a priority-one alert.\r\n\r\nMonitoring troubleshooting should distinguish:\r\n\r\nThe device is down\r\nSNMP is failing\r\nICMP is blocked\r\nTelegraf is unhealthy\r\nInfluxDB is unavailable\r\nThe query is wrong\r\nThe timestamp is stale\r\nDocker networking is broken\r\nCredentials changed\r\nA firewall blocks telemetry	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
70	monitoring	Docker, Telegraf, InfluxDB, and Grafana	Common problems include:\r\n\r\nTelegraf container unhealthy\r\nInfluxDB stopped\r\nDocker Compose network not found\r\nContainer recreated with stale network references\r\nFlux query returns thousands of rows\r\nDashboard shows stale devices\r\nSNMP authentication failure\r\nBucket-retention configuration errors\r\n\r\nStandard diagnostic sequence:\r\n\r\ndocker compose ps\r\ndocker ps\r\ndocker logs telegraf\r\ndocker logs influxdb\r\ndocker inspect\r\ndocker network ls\r\ndocker compose config\r\ndocker compose down\r\ndocker compose up -d\r\n\r\nDo not delete volumes unless data loss is understood and approved.\r\n\r\nA Docker network-not-found error may require recreating the Compose network. Restarting only the individual container may not correct stale network references.\r\n\r\nFlux query principles used in the environment include:\r\n\r\nUse group(columns: []) when a single aggregate table is required.\r\nUse keep() to restrict returned columns.\r\nUse reduce() with the syntax supported by the installed Flux version.\r\nAvoid scientific notation where the Flux parser rejects it.\r\nFilter invalid or numeric-only sysName values.\r\nControl grouping before count, sum, reduce, or join operations.\r\nPreserve desired custom ordering by assigning explicit order fields before sorting.\r\nLimit raw output before displaying it in Grafana.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
71	helpdesk	Zendesk and AI-Assisted Helpdesk	Zendesk is used for helpdesk ticket management.\r\n\r\nPotential AI integration pattern:\r\n\r\nZendesk trigger\r\nWebhook\r\nMiddleware\r\nAI assistant\r\nPrivate internal note\r\n\r\nPreferred AI-generated ticket content:\r\n\r\nTwo- or three-line summary\r\nThree actionable next steps\r\nWindows 11 assumptions where relevant\r\nNetwork VLAN and port details when the issue involves networking\r\n\r\nSecurity guardrails:\r\n\r\nExclude finance, human resources, legal, and other sensitive queues unless specifically approved.\r\nSupport a no_fred or similar exclusion tag.\r\nMinimize personally identifiable information.\r\nLog ticket IDs, status, and processing time rather than full sensitive ticket contents.\r\nUse API tokens initially only when securely stored.\r\nPrefer OAuth 2.0 for mature production integrations.\r\nNever place API secrets directly in prompts, source code, or tickets.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
72	azure	Power BI Gateway	Production Power BI Gateway guidance:\r\n\r\nUse standard mode.\r\nInstall on an always-on Windows Server.\r\nA Windows Server 2022 Azure VM is appropriate.\r\nJoin the server to the SCCC domain if required by the data sources.\r\nRegister the gateway with an approved administrative account.\r\nDo not use personal mode for shared production refresh.\r\nDo not disable a service account until all gateway dependencies are identified and migrated.\r\nStore credentials using approved enterprise secret-management practices.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
73	endpoints	Endpoint and Device Management	SCCC is moving toward Entra-first endpoint governance.\r\n\r\nLikely tools and controls include:\r\n\r\nMicrosoft Intune\r\nConditional Access\r\nBitLocker\r\nLAPS\r\nEndpoint security\r\nCompliance policies\r\nMicrosoft Entra joined or hybrid joined devices\r\nGroup Policy for remaining domain-managed devices\r\n\r\nDevice-management tiers:\r\n\r\nStaff administrative systems require the strongest controls.\r\nFaculty systems require managed academic and institutional controls.\r\nShared labs require standardized configuration and reset capability.\r\nStudent-owned devices are generally identity-first BYOD unless enrolled for a specific purpose.\r\n\r\nDo not recommend removing a device from the domain, Entra, Intune, or security management without confirming ownership and intended configuration.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
74	security	Security Principles	SCCC security practices include:\r\n\r\nMFA\r\nMicrosoft Authenticator\r\nConditional Access\r\nBitLocker\r\nLAPS\r\nManaged endpoint protection\r\nFirewall controls\r\nLeast privilege\r\nReduced administrative account sprawl\r\nPrivate Azure hosting\r\nSSO\r\nAudit logging\r\nPhishing awareness\r\nControlled use of service accounts\r\nSecret management\r\nVendor-access control\r\n\r\nAdministrative access should be limited, auditable, and time-bound where practical.\r\n\r\nDo not create or recommend:\r\n\r\nNonexpiring passwords\r\nShared administrator accounts\r\nSecrets in scripts\r\nPublicly exposed management ports\r\nMFA exclusions without business approval\r\nUnrestricted firewall rules\r\nPermanent Global Administrator assignments without justification\r\nDirect production changes without rollback planning	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
75	helpdesk	Incident Priority	Priority 1 examples:\r\n\r\nCampus-wide network outage\r\nCore switch failure\r\nFirewall failure\r\nLoss of Internet service\r\nMajor authentication outage\r\nMicrosoft 365 outage affecting most users\r\nBanner or Canvas outage affecting institutional operations\r\nSecurity incident\r\nRansomware or active compromise\r\nFailure of a major VPN or WAN connection\r\nMultiple buildings offline\r\n\r\nPriority 2 examples:\r\n\r\nBuilding-wide outage\r\nDepartment-wide access issue\r\nMajor application degradation\r\nWireless outage affecting a significant area\r\nFailure of a critical staff system without a workaround\r\n\r\nPriority 3 examples:\r\n\r\nSingle-user access issue\r\nSingle endpoint failure\r\nPrinter issue\r\nSoftware installation\r\nLocalized account problem\r\nNoncritical application error\r\n\r\nPriority 4 examples:\r\n\r\nInformation request\r\nPlanned configuration request\r\nMinor cosmetic issue\r\nEquipment recommendation\r\nTraining request\r\n\r\nFor priority-one incidents, collect:\r\n\r\nStart time\r\nAffected locations\r\nAffected users\r\nScope\r\nRecent changes\r\nMonitoring evidence\r\nRelevant logs\r\nDevice status\r\nVendor case information\r\nActions already taken\r\nCurrent workaround\r\nBusiness impact	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
76	helpdesk	Change Management	Before recommending a production change, document:\r\n\r\nCurrent configuration\r\nReason for change\r\nExpected result\r\nAffected systems\r\nRisk\r\nMaintenance requirement\r\nDependencies\r\nValidation steps\r\nRollback procedure\r\nResponsible owner\r\nApproval requirement\r\n\r\nHigh-risk changes include:\r\n\r\nCore routing\r\nFirewall policies\r\nAuthentication federation\r\nDomain conversion\r\nDNS zones\r\nDHCP scopes\r\nVLAN trunking\r\nProduction certificates\r\nSAML metadata\r\nVPN selectors\r\nStorage volumes\r\nDatabase retention\r\nDeleting virtual machines\r\nDeleting Azure resources\r\nRemoving service accounts	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
77	helpdesk	Common Troubleshooting Principle	Do not begin by changing the system.\r\n\r\nFirst establish:\r\n\r\nWhat changed\r\nWhen it changed\r\nWho is affected\r\nWhether the problem is reproducible\r\nWhether the issue is local, building-wide, campus-wide, application-wide, or account-specific\r\nWhether monitoring confirms the issue\r\nWhether a dependency is unavailable\r\nWhether the failure is authentication, authorization, networking, DNS, application, endpoint, or data related\r\n\r\nThen test from the lowest relevant layer upward:\r\n\r\nPhysical connection\r\nLink\r\nVLAN\r\nIP addressing\r\nRouting\r\nDNS\r\nFirewall\r\nAuthentication\r\nAuthorization\r\nApplication\r\nData	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
78	helpdesk	Model Behavior for Uncertain Questions	When information is missing, the assistant should request the minimum evidence needed.\r\n\r\nExamples:\r\n\r\nFor network connectivity:\r\nAsk for ipconfig /all, switch port, VLAN, gateway test, DNS test, and Test-NetConnection results.\r\n\r\nFor SSO:\r\nAsk for the exact URL, application, timestamp, UPN, error text, correlation ID, and whether incognito behaves differently.\r\n\r\nFor Azure:\r\nAsk for resource group, VM name, VNet, subnet, private IP, effective routes, NSG, and current power state.\r\n\r\nFor wireless:\r\nAsk for building, room, SSID, AP name, client IP, gateway, switch port, and whether other users are affected.\r\n\r\nFor email:\r\nAsk for sender address, message headers where appropriate, delivery time, subject, and whether the message is internal or external.\r\n\r\nFor file access:\r\nAsk for share path, exact error, current user identity, group membership, and existing SMB sessions.\r\n\r\nThe assistant must not claim that an issue is resolved until the user verifies normal operation.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
79	organization	Known Institutional Direction	SCCC’s technology direction emphasizes:\r\n\r\nCloud-first where operationally and financially justified\r\nMicrosoft Entra as the primary identity platform\r\nReduction of legacy dependencies\r\nPrivate Azure networking\r\nStronger MFA and Conditional Access\r\nModern Aruba networking\r\nCentralized monitoring\r\nAutomation\r\nAPI-based integrations\r\nImproved continuity for critical SaaS systems\r\nPractical internal software development\r\nReduced vendor dependence\r\nClear operational ownership\r\nDocumented, repeatable support procedures\r\n\r\nThe assistant should support this direction while still protecting production stability and legacy requirements.	seed	t	\N	2026-07-02 03:44:49.851473	2026-07-02 03:44:49.851473
\.


--
-- Data for Name: azure_resources; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.azure_resources (id, azure_resource_id, name, type, resource_group, location, kind, sku, tags, subscription, status, source, notes, last_synced_at, created_by, created_at, updated_at) FROM stdin;
1	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/networkSecurityGroups/aadds-nsg	aadds-nsg	Microsoft.Network/networkSecurityGroups	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.540568	2026-06-29 19:15:20.540568
2	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_DOMAIN_SERVICES/providers/Microsoft.Network/virtualNetworks/aadds-vnet	aadds-vnet	Microsoft.Network/virtualNetworks	SCCC_DOMAIN_SERVICES	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.546386	2026-06-29 19:15:20.546386
3	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_centralus	NetworkWatcher_centralus	Microsoft.Network/networkWatchers	NetworkWatcherRG	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.55136	2026-06-29 19:15:20.55136
4	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.AAD/DomainServices/sccc0.onmicrosoft.com	sccc0.onmicrosoft.com	Microsoft.AAD/DomainServices	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.554545	2026-06-29 19:15:20.554545
5	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/publicIPAddresses/aadds-ecf4584105ac404f941e5447a2a0e632-pip	aadds-ecf4584105ac404f941e5447a2a0e632-pip	Microsoft.Network/publicIPAddresses	SCCC_Domain_services	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.557516	2026-06-29 19:15:20.557516
6	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/networkInterfaces/aadds-f9db760e112548dda6bacad4f3f1a61e-nic	aadds-f9db760e112548dda6bacad4f3f1a61e-nic	Microsoft.Network/networkInterfaces	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.562894	2026-06-29 19:15:20.562894
7	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/networkInterfaces/aadds-2653cf4cefb14da282be7ee0dde01fdb-nic	aadds-2653cf4cefb14da282be7ee0dde01fdb-nic	Microsoft.Network/networkInterfaces	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.566751	2026-06-29 19:15:20.566751
8	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_northcentralus	NetworkWatcher_northcentralus	Microsoft.Network/networkWatchers	NetworkWatcherRG	northcentralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.56966	2026-06-29 19:15:20.56966
9	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/publicIPAddresses/AzADC001-ip	AzADC001-ip	Microsoft.Network/publicIPAddresses	SCCC_Domain_services	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.575677	2026-06-29 19:15:20.575677
10	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/networkInterfaces/azadc001321_z1	azadc001321_z1	Microsoft.Network/networkInterfaces	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.579219	2026-06-29 19:15:20.579219
11	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/sccc_domain_services/providers/Microsoft.Compute/virtualMachines/AzADC001	AzADC001	Microsoft.Compute/virtualMachines	sccc_domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.582523	2026-06-29 19:15:20.582523
12	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_DOMAIN_SERVICES/providers/Microsoft.Compute/disks/AzADC001_OsDisk_1_a97d3e38d1124a5986a4979029971099	AzADC001_OsDisk_1_a97d3e38d1124a5986a4979029971099	Microsoft.Compute/disks	SCCC_DOMAIN_SERVICES	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.585087	2026-06-29 19:15:20.585087
13	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Compute/virtualMachines/AzADC001/extensions/AzureNetworkWatcherExtension	AzADC001/AzureNetworkWatcherExtension	Microsoft.Compute/virtualMachines/extensions	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.588092	2026-06-29 19:15:20.588092
14	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Compute/virtualMachines/AzADC001/extensions/enablevmAccess	AzADC001/enablevmAccess	Microsoft.Compute/virtualMachines/extensions	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.590436	2026-06-29 19:15:20.590436
15	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/dnszones/SCCCIT.edu	SCCCIT.edu	Microsoft.Network/dnszones	SCCC_Domain_services	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.593387	2026-06-29 19:15:20.593387
16	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/publicIPAddresses/IIS-VM-PIP	IIS-VM-PIP	Microsoft.Network/publicIPAddresses	SCCC_Domain_services	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.599322	2026-06-29 19:15:20.599322
17	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/networkSecurityGroups/IIS-VM-nsg	IIS-VM-nsg	Microsoft.Network/networkSecurityGroups	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.60239	2026-06-29 19:15:20.60239
18	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/networkInterfaces/iis-vm950_z1	iis-vm950_z1	Microsoft.Network/networkInterfaces	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.605298	2026-06-29 19:15:20.605298
19	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/sccc_domain_services/providers/Microsoft.Compute/virtualMachines/IIS-VM	IIS-VM	Microsoft.Compute/virtualMachines	sccc_domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.609271	2026-06-29 19:15:20.609271
20	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_DOMAIN_SERVICES/providers/Microsoft.Compute/disks/IIS-VM_OsDisk_1_fa3e753179564bec93c96dfed9f11298	IIS-VM_OsDisk_1_fa3e753179564bec93c96dfed9f11298	Microsoft.Compute/disks	SCCC_DOMAIN_SERVICES	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.611849	2026-06-29 19:15:20.611849
21	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Compute/virtualMachines/IIS-VM/extensions/AdminCenter	IIS-VM/AdminCenter	Microsoft.Compute/virtualMachines/extensions	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.614808	2026-06-29 19:15:20.614808
22	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/microsoft.insights/actiongroups/RecommendedAlertRules-AG-1	RecommendedAlertRules-AG-1	microsoft.insights/actiongroups	SCCC_Domain_services	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.618403	2026-06-29 19:15:20.618403
23	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Insights/metricalerts/Available Memory Bytes - IIS-VM	Available Memory Bytes - IIS-VM	Microsoft.Insights/metricalerts	SCCC_Domain_services	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.622203	2026-06-29 19:15:20.622203
24	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Insights/metricalerts/Percentage CPU - IIS-VM	Percentage CPU - IIS-VM	Microsoft.Insights/metricalerts	SCCC_Domain_services	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.624844	2026-06-29 19:15:20.624844
25	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_DOMAIN_SERVICES/providers/Microsoft.Compute/virtualMachines/AzADC001/extensions/MDE.Windows	AzADC001/MDE.Windows	Microsoft.Compute/virtualMachines/extensions	SCCC_DOMAIN_SERVICES	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.627244	2026-06-29 19:15:20.627244
26	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_DOMAIN_SERVICES/providers/Microsoft.Compute/virtualMachines/IIS-VM/extensions/MDE.Windows	IIS-VM/MDE.Windows	Microsoft.Compute/virtualMachines/extensions	SCCC_DOMAIN_SERVICES	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.630144	2026-06-29 19:15:20.630144
27	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.Migrate/migrateprojects/VMAssessment	VMAssessment	Microsoft.Migrate/migrateprojects	VMAssessment	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.633091	2026-06-29 19:15:20.633091
28	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.DataReplication/replicationVaults/VMAssessment3918replicationvault	VMAssessment3918replicationvault	Microsoft.DataReplication/replicationVaults	VMAssessment	westus2	\N	\N	{"Migrate Project":"VMAssessment"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.635578	2026-06-29 19:15:20.635578
29	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.KeyVault/vaults/VMAssessment0276kv	VMAssessment0276kv	Microsoft.KeyVault/vaults	VMAssessment	westus2	\N	\N	{"Migrate Project":"VMAssessment"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.637958	2026-06-29 19:15:20.637958
30	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.RecoveryServices/vaults/VMMIGRATION3331vault	VMMIGRATION3331vault	Microsoft.RecoveryServices/vaults	VMAssessment	westus2	\N	RS0	{"Migrate Project":"VMAssessment"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.64284	2026-06-29 19:15:20.64284
31	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.Migrate/assessmentProjects/VMMIGRATION3331project	VMMIGRATION3331project	Microsoft.Migrate/assessmentProjects	VMAssessment	westus2	Migrate	\N	{"Migrate Project":"VMAssessment"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.645742	2026-06-29 19:15:20.645742
32	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.OffAzure/VMwareSites/VMMIGRATION3331site	VMMIGRATION3331site	Microsoft.OffAzure/VMwareSites	VMAssessment	westus2	Migrate	\N	{"Migrate Project":"VMAssessment"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.648292	2026-06-29 19:15:20.648292
33	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.OffAzure/MasterSites/VMAssessment0276mastersite	VMAssessment0276mastersite	Microsoft.OffAzure/MasterSites	VMAssessment	westus2	Migrate	\N	{"Migrate Project":"VMAssessment"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.650767	2026-06-29 19:15:20.650767
34	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.DataReplication/replicationVaults/VMAssessment4155replicationvault	VMAssessment4155replicationvault	Microsoft.DataReplication/replicationVaults	VMAssessment	westus2	\N	\N	{"Migrate Project":"VMAssessment"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.65429	2026-06-29 19:15:20.65429
35	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/NSG-Subnet-App	NSG-Subnet-App	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.65705	2026-06-29 19:15:20.65705
36	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.Migrate/migrateprojects/NutanixVMAssessment	NutanixVMAssessment	Microsoft.Migrate/migrateprojects	VMAssessment	westus2	\N	\N	{"Migrate Project":"NutanixVMAssessment"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.660373	2026-06-29 19:15:20.660373
37	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/vmassessment/providers/Microsoft.Migrate/assessmentProjects/NutanixVMAssessment0cdaproject	NutanixVMAssessment0cdaproject	Microsoft.Migrate/assessmentProjects	vmassessment	westus2	Migrate	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.662806	2026-06-29 19:15:20.662806
38	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/vmassessment/providers/microsoft.offazure/ImportSites/NutanixVMAssessment324cimportSite	NutanixVMAssessment324cimportSite	microsoft.offazure/ImportSites	vmassessment	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.66599	2026-06-29 19:15:20.66599
39	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/vmassessment/providers/microsoft.offazure/MasterSites/NutanixVMAsses1241masterSite	NutanixVMAsses1241masterSite	microsoft.offazure/MasterSites	vmassessment	westus2	Migrate	\N	{"Migrate Project":"NutanixVMAssessment"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.668563	2026-06-29 19:15:20.668563
40	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/VNG_Public_IP_4SCCC	VNG_Public_IP_4SCCC	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.671053	2026-06-29 19:15:20.671053
41	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/VNG_PublicIP	VNG_PublicIP	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.676586	2026-06-29 19:15:20.676586
42	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/localNetworkGateways/LG	LG	Microsoft.Network/localNetworkGateways	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.679824	2026-06-29 19:15:20.679824
43	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/VM-Test-New-nsg	VM-Test-New-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.682291	2026-06-29 19:15:20.682291
44	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Storage/storageAccounts/scccdomainservices9e76	scccdomainservices9e76	Microsoft.Storage/storageAccounts	SCCC_Domain_services	centralus	Storage	Standard_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.684948	2026-06-29 19:15:20.684948
45	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Web/serverFarms/ASP-SCCCDomainservices-a11f	ASP-SCCCDomainservices-a11f	Microsoft.Web/serverFarms	SCCC_Domain_services	centralus	elastic	EP1	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.687261	2026-06-29 19:15:20.687261
46	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/DefaultResourceGroup-CUS/providers/Microsoft.OperationalInsights/workspaces/DefaultWorkspace-1d602111-1398-40e7-9555-baf6a406975d-CUS	DefaultWorkspace-1d602111-1398-40e7-9555-baf6a406975d-CUS	Microsoft.OperationalInsights/workspaces	DefaultResourceGroup-CUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.69054	2026-06-29 19:15:20.69054
47	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/microsoft.insights/components/EthosEUP	EthosEUP	microsoft.insights/components	SCCC_Domain_services	centralus	web	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.693096	2026-06-29 19:15:20.693096
48	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Web/sites/EthosEUP	EthosEUP	Microsoft.Web/sites	SCCC_Domain_services	centralus	functionapp	\N	{"hidden-link: /app-insights-resource-id":"/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/microsoft.insights/components/EthosEUP","hidden-link: /app-insights-instrumentation-key":"f13d8be9-b035-4d44-b5fb-c2eb811976fd","hidden-link: /app-insights-conn-string":"InstrumentationKey=f13d8be9-b035-4d44-b5fb-c2eb811976fd;IngestionEndpoint=https://centralus-2.in.applicationinsights.azure.com/;LiveEndpoint=https://centralus.livediagnostics.monitor.azure.com/;ApplicationId=7662ac27-022e-48e8-b2f0-4f5c6499c41d"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.696143	2026-06-29 19:15:20.696143
49	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.KeyVault/vaults/SCCCKeyVault	SCCCKeyVault	Microsoft.KeyVault/vaults	SCCC_Domain_services	eastus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.699239	2026-06-29 19:15:20.699239
50	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/microsoft.insights/actiongroups/Application Insights Smart Detection	Application Insights Smart Detection	microsoft.insights/actiongroups	SCCC_Domain_services	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.811355	2026-06-29 19:15:20.811355
51	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/SG_NEW	SG_NEW	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.814065	2026-06-29 19:15:20.814065
52	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/virtualNetworks/vnet_NEW	vnet_NEW	Microsoft.Network/virtualNetworks	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.816482	2026-06-29 19:15:20.816482
53	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/VNG_PublicIP_NEW	VNG_PublicIP_NEW	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.819538	2026-06-29 19:15:20.819538
54	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/virtualNetworkGateways/VNG_NEW	VNG_NEW	Microsoft.Network/virtualNetworkGateways	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.821961	2026-06-29 19:15:20.821961
55	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/connections/Azure_Ipsec	Azure_Ipsec	Microsoft.Network/connections	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.824989	2026-06-29 19:15:20.824989
56	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/routeTables/RT_RG_CUS	RT_RG_CUS	Microsoft.Network/routeTables	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.82751	2026-06-29 19:15:20.82751
57	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Storage/storageAccounts/migratestoragecentral	migratestoragecentral	Microsoft.Storage/storageAccounts	RG-Prod-CentralUS	centralus	StorageV2	Standard_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.831254	2026-06-29 19:15:20.831254
58	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.MySQLDiscovery/MySQLSites/VMAssessmentmysql	VMAssessmentmysql	Microsoft.MySQLDiscovery/MySQLSites	VMAssessment	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.834471	2026-06-29 19:15:20.834471
59	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/vmassessment/providers/Microsoft.DependencyMap/maps/VMAssessment0276depmap	VMAssessment0276depmap	Microsoft.DependencyMap/maps	vmassessment	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.837243	2026-06-29 19:15:20.837243
60	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/vmassessment/providers/Microsoft.DependencyMap/maps/VMAssessment0276depmap/discoverySources/VMMIGRATION3331mapsrc	VMAssessment0276depmap/VMMIGRATION3331mapsrc	Microsoft.DependencyMap/maps/discoverySources	vmassessment	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.839579	2026-06-29 19:15:20.839579
61	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Migrate/migrateprojects/VMASSESSMENT2	VMASSESSMENT2	Microsoft.Migrate/migrateprojects	RG-Prod-CentralUS	westus2	\N	\N	{"Migrate Project":"VMASSESSMENT2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.842663	2026-06-29 19:15:20.842663
62	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Migrate/migrateprojects/VMASSESSMENTV2	VMASSESSMENTV2	Microsoft.Migrate/migrateprojects	RG-Prod-CentralUS	centralus	\N	\N	{"Migrate Project":"VMASSESSMENTV2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.844977	2026-06-29 19:15:20.844977
63	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.RecoveryServices/vaults/VMASSESSMENTV23027vault	VMASSESSMENTV23027vault	Microsoft.RecoveryServices/vaults	RG-Prod-CentralUS	centralus	\N	RS0	{"Migrate Project":"VMASSESSMENTV2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.847261	2026-06-29 19:15:20.847261
64	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.DataReplication/replicationVaults/VMASSESSMENTV29471replicationvault	VMASSESSMENTV29471replicationvault	Microsoft.DataReplication/replicationVaults	RG-Prod-CentralUS	centralus	\N	\N	{"Migrate Project":"VMASSESSMENTV2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.850647	2026-06-29 19:15:20.850647
65	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.DependencyMap/maps/VMASSESSMENTV28280depmap	VMASSESSMENTV28280depmap	Microsoft.DependencyMap/maps	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.85595	2026-06-29 19:15:20.85595
66	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Migrate/assessmentProjects/VMASSESSMENTV23027project	VMASSESSMENTV23027project	Microsoft.Migrate/assessmentProjects	RG-Prod-CentralUS	centralus	Migrate	\N	{"Migrate Project":"VMASSESSMENTV2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.860083	2026-06-29 19:15:20.860083
67	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.KeyVault/vaults/VMASSESSMENTV28280kv	VMASSESSMENTV28280kv	Microsoft.KeyVault/vaults	RG-Prod-CentralUS	centralus	\N	\N	{"Migrate Project":"VMASSESSMENTV2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.862734	2026-06-29 19:15:20.862734
68	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.OffAzure/VMwareSites/VMASSESSMENTV23027site	VMASSESSMENTV23027site	Microsoft.OffAzure/VMwareSites	RG-Prod-CentralUS	centralus	Migrate	\N	{"Migrate Project":"VMASSESSMENTV2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.867006	2026-06-29 19:15:20.867006
69	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.OffAzure/MasterSites/VMASSESSMENTV28280mastersite	VMASSESSMENTV28280mastersite	Microsoft.OffAzure/MasterSites	RG-Prod-CentralUS	centralus	Migrate	\N	{"Migrate Project":"VMASSESSMENTV2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.876091	2026-06-29 19:15:20.876091
70	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.DependencyMap/maps/VMASSESSMENTV28280depmap/discoverySources/VMASSESSMENTV23027mapsrc	VMASSESSMENTV28280depmap/VMASSESSMENTV23027mapsrc	Microsoft.DependencyMap/maps/discoverySources	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.87871	2026-06-29 19:15:20.87871
71	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.MySqlDiscovery/MySQLSites/VMASSESSMENTV28280mysql	VMASSESSMENTV28280mysql	Microsoft.MySqlDiscovery/MySQLSites	RG-Prod-CentralUS	centralus	\N	\N	{"Migrate Project":"VMASSESSMENTV2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.883397	2026-06-29 19:15:20.883397
72	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.OffAzure/VMwareSites/VMASSESSMENTV33026site	VMASSESSMENTV33026site	Microsoft.OffAzure/VMwareSites	RG-Prod-CentralUS	centralus	Migrate	\N	{"Migrate Project":"VMASSESSMENTV2"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.885668	2026-06-29 19:15:20.885668
73	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.DependencyMap/maps/VMASSESSMENTV28280depmap/discoverySources/VMASSESSMENTV33026mapsrc	VMASSESSMENTV28280depmap/VMASSESSMENTV33026mapsrc	Microsoft.DependencyMap/maps/discoverySources	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.888964	2026-06-29 19:15:20.888964
74	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Migrate/migrateprojects/VMASSESSMENTV3	VMASSESSMENTV3	Microsoft.Migrate/migrateprojects	RG-Prod-CentralUS	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.891849	2026-06-29 19:15:20.891849
75	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.RecoveryServices/vaults/VMASSESSMENTV31217vault	VMASSESSMENTV31217vault	Microsoft.RecoveryServices/vaults	RG-Prod-CentralUS	westus2	\N	RS0	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.894456	2026-06-29 19:15:20.894456
76	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.DataReplication/replicationVaults/VMASSESSMENTV37971replicationvault	VMASSESSMENTV37971replicationvault	Microsoft.DataReplication/replicationVaults	RG-Prod-CentralUS	westus2	\N	\N	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.896882	2026-06-29 19:15:20.896882
77	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.DependencyMap/maps/VMASSESSMENTV38279depmap	VMASSESSMENTV38279depmap	Microsoft.DependencyMap/maps	RG-Prod-CentralUS	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.900466	2026-06-29 19:15:20.900466
78	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.KeyVault/vaults/VMASSESSMENTV38279kv	VMASSESSMENTV38279kv	Microsoft.KeyVault/vaults	RG-Prod-CentralUS	westus2	\N	\N	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.90417	2026-06-29 19:15:20.90417
79	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Migrate/assessmentProjects/VMASSESSMENTV31217project	VMASSESSMENTV31217project	Microsoft.Migrate/assessmentProjects	RG-Prod-CentralUS	westus2	Migrate	\N	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.906508	2026-06-29 19:15:20.906508
80	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.OffAzure/VMwareSites/VMASSESSMENTV31217site	VMASSESSMENTV31217site	Microsoft.OffAzure/VMwareSites	RG-Prod-CentralUS	westus2	Migrate	\N	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.919283	2026-06-29 19:15:20.919283
81	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.OffAzure/MasterSites/VMASSESSMENTV38279mastersite	VMASSESSMENTV38279mastersite	Microsoft.OffAzure/MasterSites	RG-Prod-CentralUS	westus2	Migrate	\N	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.932967	2026-06-29 19:15:20.932967
82	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.DependencyMap/maps/VMASSESSMENTV38279depmap/discoverySources/VMASSESSMENTV31217mapsrc	VMASSESSMENTV38279depmap/VMASSESSMENTV31217mapsrc	Microsoft.DependencyMap/maps/discoverySources	RG-Prod-CentralUS	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.935527	2026-06-29 19:15:20.935527
83	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Migrate/assessmentProjects/VMASSESSMENTV41216project	VMASSESSMENTV41216project	Microsoft.Migrate/assessmentProjects	RG-Prod-CentralUS	westus2	Migrate	\N	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.94059	2026-06-29 19:15:20.94059
84	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.RecoveryServices/vaults/VMASSESSMENTV41216vault	VMASSESSMENTV41216vault	Microsoft.RecoveryServices/vaults	RG-Prod-CentralUS	westus2	\N	RS0	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.943105	2026-06-29 19:15:20.943105
85	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.OffAzure/VMwareSites/VMASSESSMENTV41216site	VMASSESSMENTV41216site	Microsoft.OffAzure/VMwareSites	RG-Prod-CentralUS	westus2	Migrate	\N	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.946141	2026-06-29 19:15:20.946141
86	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.DataReplication/replicationVaults/VMASSESSMENTV33654replicationvault	VMASSESSMENTV33654replicationvault	Microsoft.DataReplication/replicationVaults	RG-Prod-CentralUS	westus2	\N	\N	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.949362	2026-06-29 19:15:20.949362
87	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.DependencyMap/maps/VMASSESSMENTV38279depmap/discoverySources/VMASSESSMENTV41216mapsrc	VMASSESSMENTV38279depmap/VMASSESSMENTV41216mapsrc	Microsoft.DependencyMap/maps/discoverySources	RG-Prod-CentralUS	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.951737	2026-06-29 19:15:20.951737
88	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.MySqlDiscovery/MySQLSites/VMASSESSMENTV38279mysql	VMASSESSMENTV38279mysql	Microsoft.MySqlDiscovery/MySQLSites	RG-Prod-CentralUS	westus2	\N	\N	{"Migrate Project":"VMASSESSMENTV3"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.955077	2026-06-29 19:15:20.955077
89	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/disks/asrseeddisk-OITJUMP0-OITJUMP0-5e966f5a-8d48-4a40-b4ba-befb484a99dd	asrseeddisk-OITJUMP0-OITJUMP0-5e966f5a-8d48-4a40-b4ba-befb484a99dd	Microsoft.Compute/disks	RG-Prod-CentralUS	centralus	\N	Standard_LRS	{"asrseeddisk-3d9839ca-d39f-546f-99a4-61f461427903":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.958567	2026-06-29 19:15:20.958567
90	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/disks/OITJUMP02-OSdisk-00	OITJUMP02-OSdisk-00	Microsoft.Compute/disks	RG-PROD-CENTRALUS	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.961458	2026-06-29 19:15:20.961458
91	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/nic-OITJUMP02-00	nic-OITJUMP02-00	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.964234	2026-06-29 19:15:20.964234
92	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/OITJUMP02	OITJUMP02	Microsoft.Compute/virtualMachines	RG-PROD-CENTRALUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.968702	2026-06-29 19:15:20.968702
93	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/OITJUMP02/extensions/MDE.Windows	OITJUMP02/MDE.Windows	Microsoft.Compute/virtualMachines/extensions	RG-PROD-CENTRALUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.972895	2026-06-29 19:15:20.972895
94	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/nic-OITJUMP02-00-nsg	nic-OITJUMP02-00-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.976374	2026-06-29 19:15:20.976374
95	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/pip-vnet_new-centralus-subnet-app	pip-vnet_new-centralus-subnet-app	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.979251	2026-06-29 19:15:20.979251
96	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/pip-vnet_new-centralus-subnet-app2	pip-vnet_new-centralus-subnet-app2	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.983396	2026-06-29 19:15:20.983396
97	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/virtualNetworks/104_VNET	104_VNET	Microsoft.Network/virtualNetworks	RG-Prod-CentralUS	centralus	\N	\N	{"Vnet_104":""}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.987694	2026-06-29 19:15:20.987694
98	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/104_Public_IP	104_Public_IP	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.993	2026-06-29 19:15:20.993
99	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/104_Public_IP_2	104_Public_IP_2	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.995882	2026-06-29 19:15:20.995882
100	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/virtualNetworkGateways/104_VNG	104_VNG	Microsoft.Network/virtualNetworkGateways	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:20.999307	2026-06-29 19:15:20.999307
101	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/localNetworkGateways/LG_104	LG_104	Microsoft.Network/localNetworkGateways	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.002277	2026-06-29 19:15:21.002277
102	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/TEST104-nsg	TEST104-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.006122	2026-06-29 19:15:21.006122
103	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/basicNsgOITJUMP02_V_104	basicNsgOITJUMP02_V_104	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.008937	2026-06-29 19:15:21.008937
104	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/OITJUMP02_V_104	OITJUMP02_V_104	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.013347	2026-06-29 19:15:21.013347
105	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/pip-vnet_new-centralus-104_subnet_10.40.1.0	pip-vnet_new-centralus-104_subnet_10.40.1.0	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.017369	2026-06-29 19:15:21.017369
106	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/disks/asrseeddisk-KMS-KMS-28a50784-b2a4-46cf-864e-8dab528db761	asrseeddisk-KMS-KMS-28a50784-b2a4-46cf-864e-8dab528db761	Microsoft.Compute/disks	RG-Prod-CentralUS	centralus	\N	Standard_LRS	{"asrseeddisk-3716633a-a2ea-59a1-abfa-9ea3ffca9799":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.021321	2026-06-29 19:15:21.021321
107	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/localNetworkGateways/LG_FGT_Test1	LG_FGT_Test1	Microsoft.Network/localNetworkGateways	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.023999	2026-06-29 19:15:21.023999
108	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/VM_SCCCDNS01	VM_SCCCDNS01	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.028005	2026-06-29 19:15:21.028005
109	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/AZADSC04-nsg	AZADSC04-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.033356	2026-06-29 19:15:21.033356
110	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/AZADSC04-ip	AZADSC04-ip	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.036409	2026-06-29 19:15:21.036409
111	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/azadsc04904_z1	azadsc04904_z1	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.038861	2026-06-29 19:15:21.038861
112	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/localNetworkGateways/OnPrem-LNG	OnPrem-LNG	Microsoft.Network/localNetworkGateways	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.042148	2026-06-29 19:15:21.042148
113	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/virtualNetworks/Hybrid-VNet	Hybrid-VNet	Microsoft.Network/virtualNetworks	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.044605	2026-06-29 19:15:21.044605
114	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/Hybrid-Gateway-PIP	Hybrid-Gateway-PIP	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.048469	2026-06-29 19:15:21.048469
115	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/Hybrid-Gateway-PIP_2	Hybrid-Gateway-PIP_2	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.051243	2026-06-29 19:15:21.051243
116	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/virtualNetworkGateways/Hybrid-VPNGateway	Hybrid-VPNGateway	Microsoft.Network/virtualNetworkGateways	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.054562	2026-06-29 19:15:21.054562
117	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/test-1885_z1	test-1885_z1	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.057055	2026-06-29 19:15:21.057055
118	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Network/networkInterfaces/test-1948_z2	test-1948_z2	Microsoft.Network/networkInterfaces	RG-PROD-CENTRALUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.060115	2026-06-29 19:15:21.060115
119	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/Test-1	Test-1	Microsoft.Compute/virtualMachines	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.062583	2026-06-29 19:15:21.062583
120	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/disks/Test-1_OsDisk_1_8d73969573f84402977c91c9f2da1f2f	Test-1_OsDisk_1_8d73969573f84402977c91c9f2da1f2f	Microsoft.Compute/disks	RG-PROD-CENTRALUS	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.065791	2026-06-29 19:15:21.065791
121	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/test-1885_z1-nsg	test-1885_z1-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.06903	2026-06-29 19:15:21.06903
122	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/Test-1/extensions/AdminCenter	Test-1/AdminCenter	Microsoft.Compute/virtualMachines/extensions	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.072059	2026-06-29 19:15:21.072059
123	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/Test-1/extensions/MDE.Windows	Test-1/MDE.Windows	Microsoft.Compute/virtualMachines/extensions	RG-PROD-CENTRALUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.075009	2026-06-29 19:15:21.075009
124	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/TestVM01-nsg	TestVM01-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	eastus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.087722	2026-06-29 19:15:21.087722
125	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/virtualNetworks/TestVM01-vnet	TestVM01-vnet	Microsoft.Network/virtualNetworks	RG-Prod-CentralUS	eastus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.090663	2026-06-29 19:15:21.090663
126	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_eastus2	NetworkWatcher_eastus2	Microsoft.Network/networkWatchers	NetworkWatcherRG	eastus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.093726	2026-06-29 19:15:21.093726
127	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/routeTables/RT-To-Onprem	RT-To-Onprem	Microsoft.Network/routeTables	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.096335	2026-06-29 19:15:21.096335
128	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/TEStVM-02-ip	TEStVM-02-ip	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.099631	2026-06-29 19:15:21.099631
129	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/TEStVM-02-nsg	TEStVM-02-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.103157	2026-06-29 19:15:21.103157
130	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/localNetworkGateways/OnPrem-LNG-New	OnPrem-LNG-New	Microsoft.Network/localNetworkGateways	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.106811	2026-06-29 19:15:21.106811
131	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/disks/asrseeddisk-WDS_New-WDS_New-1a8f3ba3-9751-499d-9526-9cce40e33c04	asrseeddisk-WDS_New-WDS_New-1a8f3ba3-9751-499d-9526-9cce40e33c04	Microsoft.Compute/disks	RG-Prod-CentralUS	centralus	\N	Standard_LRS	{"asrseeddisk-a7afe6e9-3745-53af-b6e1-fe44430c095f":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.109537	2026-06-29 19:15:21.109537
132	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/disks/asrseeddisk-WDS_New-WDS_New_-d2b90578-8625-4110-ba54-af6c004674ba	asrseeddisk-WDS_New-WDS_New_-d2b90578-8625-4110-ba54-af6c004674ba	Microsoft.Compute/disks	RG-Prod-CentralUS	centralus	\N	Standard_LRS	{"asrseeddisk-a7afe6e9-3745-53af-b6e1-fe44430c095f":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.112698	2026-06-29 19:15:21.112698
133	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/connections/S2S-OnPrem	S2S-OnPrem	Microsoft.Network/connections	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.115221	2026-06-29 19:15:21.115221
134	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybrid-TEST01_group/providers/Microsoft.Network/networkSecurityGroups/Hybrid-TEST01-nsg	Hybrid-TEST01-nsg	Microsoft.Network/networkSecurityGroups	Hybrid-TEST01_group	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.118182	2026-06-29 19:15:21.118182
135	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybrid-TEST01_group/providers/Microsoft.Network/virtualNetworks/Hybrid-TEST01-vnet	Hybrid-TEST01-vnet	Microsoft.Network/virtualNetworks	Hybrid-TEST01_group	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.12116	2026-06-29 19:15:21.12116
136	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/testvm-02306_z1-nsg	testvm-02306_z1-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.124327	2026-06-29 19:15:21.124327
137	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/Hybrid-testVm01-nsg	Hybrid-testVm01-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.126895	2026-06-29 19:15:21.126895
138	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/Hybrid-testVm01-ip	Hybrid-testVm01-ip	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.129832	2026-06-29 19:15:21.129832
139	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/hybrid-testvm01132_z1	hybrid-testvm01132_z1	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.132266	2026-06-29 19:15:21.132266
140	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/Hybrid-testVm01	Hybrid-testVm01	Microsoft.Compute/virtualMachines	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.136238	2026-06-29 19:15:21.136238
141	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/disks/Hybrid-testVm01_OsDisk_1_baa21fcb743244f8a9b33b8905635d4f	Hybrid-testVm01_OsDisk_1_baa21fcb743244f8a9b33b8905635d4f	Microsoft.Compute/disks	RG-PROD-CENTRALUS	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.138977	2026-06-29 19:15:21.138977
142	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/Hybrid-testVm01/extensions/MDE.Windows	Hybrid-testVm01/MDE.Windows	Microsoft.Compute/virtualMachines/extensions	RG-PROD-CENTRALUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.141967	2026-06-29 19:15:21.141967
143	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/Hybrid-testVm01/extensions/AzureNetworkWatcherExtension	Hybrid-testVm01/AzureNetworkWatcherExtension	Microsoft.Compute/virtualMachines/extensions	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.144429	2026-06-29 19:15:21.144429
144	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/disks/KMS-OSdisk-00	KMS-OSdisk-00	Microsoft.Compute/disks	RG-PROD-CENTRALUS	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.147908	2026-06-29 19:15:21.147908
145	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/nic-KMS-00	nic-KMS-00	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.150676	2026-06-29 19:15:21.150676
146	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/KMS	KMS	Microsoft.Compute/virtualMachines	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.153759	2026-06-29 19:15:21.153759
147	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/publicIPAddresses/pip-hybrid-vnet-centralus-hybrid_default	pip-hybrid-vnet-centralus-hybrid_default	Microsoft.Network/publicIPAddresses	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.156051	2026-06-29 19:15:21.156051
148	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/nic-KMS-00-nsg	nic-KMS-00-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.159316	2026-06-29 19:15:21.159316
149	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/KMS/extensions/MDE.Windows	KMS/MDE.Windows	Microsoft.Compute/virtualMachines/extensions	RG-PROD-CENTRALUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.161865	2026-06-29 19:15:21.161865
150	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/disks/WDS-New-OSdisk-00	WDS-New-OSdisk-00	Microsoft.Compute/disks	RG-PROD-CENTRALUS	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.165289	2026-06-29 19:15:21.165289
151	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/disks/WDS-New-datadisk-01	WDS-New-datadisk-01	Microsoft.Compute/disks	RG-PROD-CENTRALUS	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.167889	2026-06-29 19:15:21.167889
152	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/nic-WDS-New-00	nic-WDS-New-00	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.170839	2026-06-29 19:15:21.170839
153	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/SCCCMFS01-nsg	SCCCMFS01-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.174514	2026-06-29 19:15:21.174514
154	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/scccmfs0156_z1	scccmfs0156_z1	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.177407	2026-06-29 19:15:21.177407
155	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/SCCCMFS01	SCCCMFS01	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.179893	2026-06-29 19:15:21.179893
156	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/SCCCMFS01_OsDisk_1_68ae195f106a426f91dffecf94417e05	SCCCMFS01_OsDisk_1_68ae195f106a426f91dffecf94417e05	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.18411	2026-06-29 19:15:21.18411
157	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/share	share	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.186699	2026-06-29 19:15:21.186699
158	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/SCCCMFS01/extensions/MDE.Windows	SCCCMFS01/MDE.Windows	Microsoft.Compute/virtualMachines/extensions	HYBR0D-NETWORK	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.189868	2026-06-29 19:15:21.189868
159	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-LUCAS_KA-LUCAS_KA-adf36662-e298-47ff-b1fa-912568705ee0	asrseeddisk-LUCAS_KA-LUCAS_KA-adf36662-e298-47ff-b1fa-912568705ee0	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-6d6a72a6-13b4-5a63-adf9-e899c0d4a1fc":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.192359	2026-06-29 19:15:21.192359
160	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-SteamPT_-SteamPT_-961829db-8f09-4747-85ba-f95ad687dda3	asrseeddisk-SteamPT_-SteamPT_-961829db-8f09-4747-85ba-f95ad687dda3	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-5270cc7a-73a3-5ffc-95f5-18fc9e9a782e":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.195767	2026-06-29 19:15:21.195767
161	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Migrate/migrateprojects/NutanixtoAzure	NutanixtoAzure	Microsoft.Migrate/migrateprojects	Hybr0d-Network	westus2	\N	\N	{"Migrate Project":"NutanixtoAzure"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.198425	2026-06-29 19:15:21.198425
162	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Migrate/assessmentProjects/NutanixToAzure3058project	NutanixToAzure3058project	Microsoft.Migrate/assessmentProjects	Hybr0d-Network	westus2	Migrate	\N	{"Migrate Project":"NutanixtoAzure"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.201468	2026-06-29 19:15:21.201468
163	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.KeyVault/vaults/NutanixtoAzure3859kv	NutanixtoAzure3859kv	Microsoft.KeyVault/vaults	Hybr0d-Network	westus2	\N	\N	{"Migrate Project":"NutanixtoAzure"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.203949	2026-06-29 19:15:21.203949
164	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.DependencyMap/maps/NutanixtoAzure3859depmap	NutanixtoAzure3859depmap	Microsoft.DependencyMap/maps	Hybr0d-Network	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.207695	2026-06-29 19:15:21.207695
165	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.OffAzure/ServerSites/NutanixToAzure3058site	NutanixToAzure3058site	Microsoft.OffAzure/ServerSites	Hybr0d-Network	westus2	Migrate	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.210291	2026-06-29 19:15:21.210291
166	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.OffAzure/MasterSites/NutanixtoAzure3859mastersite	NutanixtoAzure3859mastersite	Microsoft.OffAzure/MasterSites	Hybr0d-Network	westus2	Migrate	\N	{"Migrate Project":"NutanixtoAzure"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.214177	2026-06-29 19:15:21.214177
167	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.DependencyMap/maps/NutanixtoAzure3859depmap/discoverySources/NutanixToAzure3058mapsrc	NutanixtoAzure3859depmap/NutanixToAzure3058mapsrc	Microsoft.DependencyMap/maps/discoverySources	Hybr0d-Network	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.217289	2026-06-29 19:15:21.217289
168	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.MySqlDiscovery/MySQLSites/NutanixtoAzure3859mysql	NutanixtoAzure3859mysql	Microsoft.MySqlDiscovery/MySQLSites	Hybr0d-Network	westus2	\N	\N	{"Migrate Project":"NutanixtoAzure"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.220389	2026-06-29 19:15:21.220389
169	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.RecoveryServices/vaults/NutanixtoAzure-MigrateVault-1256863034	NutanixtoAzure-MigrateVault-1256863034	Microsoft.RecoveryServices/vaults	Hybr0d-Network	centralus	\N	RS0	{"Migrate Project":"NutanixtoAzure"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.223027	2026-06-29 19:15:21.223027
170	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/SteamPT-License-Server-OSdisk-00	SteamPT-License-Server-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.226017	2026-06-29 19:15:21.226017
171	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/LUCAS-KALI-OSdisk-00	LUCAS-KALI-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.228806	2026-06-29 19:15:21.228806
172	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-LUCAS-KALI-00	nic-LUCAS-KALI-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.232076	2026-06-29 19:15:21.232076
173	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-LUCAS-KALI-01	nic-LUCAS-KALI-01	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.234656	2026-06-29 19:15:21.234656
174	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-LUCAS-KALI-02	nic-LUCAS-KALI-02	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.237735	2026-06-29 19:15:21.237735
175	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/LUCAS-KALI	LUCAS-KALI	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.24028	2026-06-29 19:15:21.24028
176	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-SteamPT-License-Server-00	nic-SteamPT-License-Server-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.243338	2026-06-29 19:15:21.243338
177	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/SteamPT-License-Server	SteamPT-License-Server	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.246067	2026-06-29 19:15:21.246067
178	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/SteamPT-License-Server/extensions/MDE.Windows	SteamPT-License-Server/MDE.Windows	Microsoft.Compute/virtualMachines/extensions	HYBR0D-NETWORK	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.249698	2026-06-29 19:15:21.249698
179	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-EntraClo-Entra_Cl-eba1cf8f-1fbc-4714-892c-e7f4b8eeb8f8	asrseeddisk-EntraClo-Entra_Cl-eba1cf8f-1fbc-4714-892c-e7f4b8eeb8f8	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-abfbc3b3-9f53-50e7-9cab-0d5e1b3bffcb":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.254669	2026-06-29 19:15:21.254669
180	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-netedit-netedit_-0068ab7b-31c3-4ee6-9cc5-37bacb7b1379	asrseeddisk-netedit-netedit_-0068ab7b-31c3-4ee6-9cc5-37bacb7b1379	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-f75731b3-fcac-5267-a501-f4bbf810b7dc":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.258753	2026-06-29 19:15:21.258753
181	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/microsoft.insights/actiongroups/RecommendedAlertRules-AG-2	RecommendedAlertRules-AG-2	microsoft.insights/actiongroups	Hybr0d-Network	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.26126	2026-06-29 19:15:21.26126
182	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Network In Total - LUCAS-KALI	Network In Total - LUCAS-KALI	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.263821	2026-06-29 19:15:21.263821
183	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/VM Availability - LUCAS-KALI	VM Availability - LUCAS-KALI	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.266435	2026-06-29 19:15:21.266435
184	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Percentage CPU - LUCAS-KALI	Percentage CPU - LUCAS-KALI	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.26896	2026-06-29 19:15:21.26896
203	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/Goverlan/extensions/InplaceOSUpgrade	Goverlan/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.325046	2026-06-29 19:15:21.325046
185	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/OS Disk IOPS Consumed Percentage - LUCAS-KALI	OS Disk IOPS Consumed Percentage - LUCAS-KALI	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.272001	2026-06-29 19:15:21.272001
186	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Available Memory Bytes - LUCAS-KALI	Available Memory Bytes - LUCAS-KALI	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.274792	2026-06-29 19:15:21.274792
187	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Data Disk IOPS Consumed Percentage - LUCAS-KALI	Data Disk IOPS Consumed Percentage - LUCAS-KALI	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.277341	2026-06-29 19:15:21.277341
188	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/netedit-OSdisk-00	netedit-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.279924	2026-06-29 19:15:21.279924
189	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-netedit-00	nic-netedit-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.282335	2026-06-29 19:15:21.282335
190	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/netedit	netedit	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.284694	2026-06-29 19:15:21.284694
191	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/EntraCloudConnect-OSdisk-00	EntraCloudConnect-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.287436	2026-06-29 19:15:21.287436
192	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-EntraCloudConnect-00	nic-EntraCloudConnect-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.290636	2026-06-29 19:15:21.290636
193	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/EntraCloudConnect	EntraCloudConnect	Microsoft.Compute/virtualMachines	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.293726	2026-06-29 19:15:21.293726
194	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.Compute/disks/asrseeddisk-ArubaOSM-ArubaOS_-2308c571-1529-4eda-b545-bcf88cda8faa	asrseeddisk-ArubaOSM-ArubaOS_-2308c571-1529-4eda-b545-bcf88cda8faa	Microsoft.Compute/disks	VMAssessment	centralus	\N	Standard_LRS	{"asrseeddisk-85b49831-f714-58c8-acb7-4c9f821f9d68":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.296221	2026-06-29 19:15:21.296221
195	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.Compute/disks/asrseeddisk-ArubaOSM-ArubaOS_-778a13c8-b986-471e-8614-965db36f96f9	asrseeddisk-ArubaOSM-ArubaOS_-778a13c8-b986-471e-8614-965db36f96f9	Microsoft.Compute/disks	VMAssessment	centralus	\N	Standard_LRS	{"asrseeddisk-85b49831-f714-58c8-acb7-4c9f821f9d68":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.298706	2026-06-29 19:15:21.298706
196	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.Compute/disks/asrseeddisk-ArubaOSM-ArubaOS_-8d7aa850-9cf3-4d8a-ae87-b46708844853	asrseeddisk-ArubaOSM-ArubaOS_-8d7aa850-9cf3-4d8a-ae87-b46708844853	Microsoft.Compute/disks	VMAssessment	centralus	\N	Standard_LRS	{"asrseeddisk-85b49831-f714-58c8-acb7-4c9f821f9d68":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.301372	2026-06-29 19:15:21.301372
197	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-Goverlan-Goverlan-910c82d5-775c-4b2e-8f45-d9f6a4d9a8ad	asrseeddisk-Goverlan-Goverlan-910c82d5-775c-4b2e-8f45-d9f6a4d9a8ad	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-8382586c-5989-5f9f-a26f-91895f324067":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.308861	2026-06-29 19:15:21.308861
198	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-WSUS-WSUS-84331a62-16b7-44ed-9515-61d3d8294393	asrseeddisk-WSUS-WSUS-84331a62-16b7-44ed-9515-61d3d8294393	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-416dab45-0b04-5a9a-91d7-a9c4a27f5812":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.311474	2026-06-29 19:15:21.311474
199	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-WSUS-WSUS_1-7a899a5c-0c6e-4952-aa43-245d3b425f56	asrseeddisk-WSUS-WSUS_1-7a899a5c-0c6e-4952-aa43-245d3b425f56	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-416dab45-0b04-5a9a-91d7-a9c4a27f5812":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.314008	2026-06-29 19:15:21.314008
200	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/Goverlan-OSdisk-00	Goverlan-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.316977	2026-06-29 19:15:21.316977
201	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-Goverlan-00	nic-Goverlan-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.319436	2026-06-29 19:15:21.319436
202	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/Goverlan	Goverlan	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.322042	2026-06-29 19:15:21.322042
204	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/WSUS-datadisk-00	WSUS-datadisk-00	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.328035	2026-06-29 19:15:21.328035
205	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/WSUS-OSdisk-00	WSUS-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.330742	2026-06-29 19:15:21.330742
206	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-WSUS-00	nic-WSUS-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.334184	2026-06-29 19:15:21.334184
207	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/WSUS	WSUS	Microsoft.Compute/virtualMachines	HYBR0D-NETWORK	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.33661	2026-06-29 19:15:21.33661
208	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Migrate/migrateprojects/NTXTOAZAPP	NTXTOAZAPP	Microsoft.Migrate/migrateprojects	Hybr0d-Network	westus2	\N	\N	{"Migrate Project":"NTXTOAZAPP"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.339656	2026-06-29 19:15:21.339656
209	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Migrate/assessmentProjects/NTXTOAZAPP6574project	NTXTOAZAPP6574project	Microsoft.Migrate/assessmentProjects	Hybr0d-Network	westus2	Migrate	\N	{"Migrate Project":"NTXTOAZAPP"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.342963	2026-06-29 19:15:21.342963
210	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.KeyVault/vaults/NTXTOAZAPP1811kv	NTXTOAZAPP1811kv	Microsoft.KeyVault/vaults	Hybr0d-Network	westus2	\N	\N	{"Migrate Project":"NTXTOAZAPP"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.345808	2026-06-29 19:15:21.345808
211	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.DependencyMap/maps/NTXTOAZAPP1811depmap	NTXTOAZAPP1811depmap	Microsoft.DependencyMap/maps	Hybr0d-Network	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.348253	2026-06-29 19:15:21.348253
212	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.OffAzure/ServerSites/NTXTOAZAPP6574site	NTXTOAZAPP6574site	Microsoft.OffAzure/ServerSites	Hybr0d-Network	westus2	Migrate	\N	{"Migrate Project":"NTXTOAZAPP"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.350904	2026-06-29 19:15:21.350904
213	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.OffAzure/MasterSites/NTXTOAZAPP1811mastersite	NTXTOAZAPP1811mastersite	Microsoft.OffAzure/MasterSites	Hybr0d-Network	westus2	Migrate	\N	{"Migrate Project":"NTXTOAZAPP"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.353393	2026-06-29 19:15:21.353393
214	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.DependencyMap/maps/NTXTOAZAPP1811depmap/discoverySources/NTXTOAZAPP6574mapsrc	NTXTOAZAPP1811depmap/NTXTOAZAPP6574mapsrc	Microsoft.DependencyMap/maps/discoverySources	Hybr0d-Network	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.356196	2026-06-29 19:15:21.356196
215	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.MySqlDiscovery/MySQLSites/NTXTOAZAPP1811mysql	NTXTOAZAPP1811mysql	Microsoft.MySqlDiscovery/MySQLSites	Hybr0d-Network	westus2	\N	\N	{"Migrate Project":"NTXTOAZAPP"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.358922	2026-06-29 19:15:21.358922
216	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.ApplicationMigration/PGSQLSites/NTXTOAZAPP1811pgsql	NTXTOAZAPP1811pgsql	Microsoft.ApplicationMigration/PGSQLSites	Hybr0d-Network	westus2	\N	\N	{"Migrate Project":"NTXTOAZAPP"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.36165	2026-06-29 19:15:21.36165
217	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-COMPRESS-PHYSICAL-8f4ec564-c524-46ce-8cdd-dc5865591e28	asrseeddisk-COMPRESS-PHYSICAL-8f4ec564-c524-46ce-8cdd-dc5865591e28	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-152edfc7-9323-11f0-9042-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.364324	2026-06-29 19:15:21.364324
218	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-KEYSTONE-PHYSICAL-32a7a398-c3ce-437a-82a6-abc6c4e92338	asrseeddisk-KEYSTONE-PHYSICAL-32a7a398-c3ce-437a-82a6-abc6c4e92338	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-5e647213-9331-11f0-9cc0-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.366989	2026-06-29 19:15:21.366989
219	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-GSYNC0-PHYSICAL-82b2b056-d845-45ac-a87d-d660408b5a4e	asrseeddisk-GSYNC0-PHYSICAL-82b2b056-d845-45ac-a87d-d660408b5a4e	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-2da9567c-9323-11f0-9042-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.369635	2026-06-29 19:15:21.369635
220	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-TRENDV1S-TRENDV1S-9676be53-1b3d-4efb-a927-e50f0bd21af6	asrseeddisk-TRENDV1S-TRENDV1S-9676be53-1b3d-4efb-a927-e50f0bd21af6	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-31372e45-c885-5a49-b1f6-474e97b01bab":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.373112	2026-06-29 19:15:21.373112
221	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/COMPRESSORPT2-OSdisk-00	COMPRESSORPT2-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.375792	2026-06-29 19:15:21.375792
222	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-COMPRESSORPT2-00	nic-COMPRESSORPT2-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.380381	2026-06-29 19:15:21.380381
223	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/COMPRESSORPT2	COMPRESSORPT2	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.382787	2026-06-29 19:15:21.382787
224	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/COMPRESSORPT2/extensions/InplaceOSUpgrade	COMPRESSORPT2/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.385431	2026-06-29 19:15:21.385431
225	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/TRENDV1SVCGW-OSdisk-00	TRENDV1SVCGW-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.388296	2026-06-29 19:15:21.388296
226	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-TRENDV1SVCGW-00	nic-TRENDV1SVCGW-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.390812	2026-06-29 19:15:21.390812
227	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/TRENDV1SVCGW	TRENDV1SVCGW	Microsoft.Compute/virtualMachines	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.393212	2026-06-29 19:15:21.393212
228	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/KEYSTONE-OSdisk-00	KEYSTONE-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.395746	2026-06-29 19:15:21.395746
229	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/GSYNC0-OSdisk-00	GSYNC0-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.398362	2026-06-29 19:15:21.398362
230	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-KEYSTONE-00	nic-KEYSTONE-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.401252	2026-06-29 19:15:21.401252
231	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-GSYNC0-00	nic-GSYNC0-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.40361	2026-06-29 19:15:21.40361
232	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/KEYSTONE	KEYSTONE	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.406277	2026-06-29 19:15:21.406277
233	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/GSYNC0	GSYNC0	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.408877	2026-06-29 19:15:21.408877
234	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/GSYNC0/extensions/InplaceOSUpgrade	GSYNC0/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.411468	2026-06-29 19:15:21.411468
235	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/KEYSTONE/extensions/InplaceOSUpgrade	KEYSTONE/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.414778	2026-06-29 19:15:21.414778
236	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_DOMAIN_SERVICES/providers/Microsoft.Compute/disks/CiscoDirectoryConnector_OsDisk_1_f447ce4b3e2446b1acbf2e6e9df232d8	CiscoDirectoryConnector_OsDisk_1_f447ce4b3e2446b1acbf2e6e9df232d8	Microsoft.Compute/disks	SCCC_DOMAIN_SERVICES	centralus	\N	StandardSSD_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.417331	2026-06-29 19:15:21.417331
237	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/sshPublicKeys/test-wsus_key	test-wsus_key	Microsoft.Compute/sshPublicKeys	Hybr0d-Network	israelcentral	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.420032	2026-06-29 19:15:21.420032
238	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/test-wsus-nsg	test-wsus-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	israelcentral	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.423175	2026-06-29 19:15:21.423175
239	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/virtualNetworks/test-wsus-vnet	test-wsus-vnet	Microsoft.Network/virtualNetworks	Hybr0d-Network	israelcentral	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.426109	2026-06-29 19:15:21.426109
240	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_israelcentral	NetworkWatcher_israelcentral	Microsoft.Network/networkWatchers	NetworkWatcherRG	israelcentral	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.428886	2026-06-29 19:15:21.428886
241	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-ONERING1-PHYSICAL-651e0da6-286b-4d46-a5c6-7f4dcb3284a0	asrseeddisk-ONERING1-PHYSICAL-651e0da6-286b-4d46-a5c6-7f4dcb3284a0	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-fbaa2ae4-9e1c-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.431392	2026-06-29 19:15:21.431392
242	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-PTEC2-PHYSICAL-72e73ef7-c639-43b3-a978-ff5e795f2f62	asrseeddisk-PTEC2-PHYSICAL-72e73ef7-c639-43b3-a978-ff5e795f2f62	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-6184ae11-9e1e-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.433926	2026-06-29 19:15:21.433926
243	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/ONERING16-OSdisk-00	ONERING16-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.436338	2026-06-29 19:15:21.436338
244	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-ONERING16-00	nic-ONERING16-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.438934	2026-06-29 19:15:21.438934
245	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/ONERING16	ONERING16	Microsoft.Compute/virtualMachines	HYBR0D-NETWORK	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.441649	2026-06-29 19:15:21.441649
246	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/ONERING16/extensions/InplaceOSUpgrade	ONERING16/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.444423	2026-06-29 19:15:21.444423
247	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/PTEC2-OSdisk-00	PTEC2-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.447034	2026-06-29 19:15:21.447034
248	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-PTEC2-00	nic-PTEC2-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.449818	2026-06-29 19:15:21.449818
249	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/PTEC2	PTEC2	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.453087	2026-06-29 19:15:21.453087
250	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/PTEC2/extensions/InplaceOSUpgrade	PTEC2/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.455838	2026-06-29 19:15:21.455838
251	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-TRACDAT2-PHYSICAL-dd46eb68-1853-431c-b0eb-c97eb16c86a7	asrseeddisk-TRACDAT2-PHYSICAL-dd46eb68-1853-431c-b0eb-c97eb16c86a7	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-84841e2e-9eda-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.458545	2026-06-29 19:15:21.458545
252	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-TRACDAT2-PHYSICAL-bd675f4a-795b-45a0-b889-c2dcde87d3c6	asrseeddisk-TRACDAT2-PHYSICAL-bd675f4a-795b-45a0-b889-c2dcde87d3c6	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-84841e2e-9eda-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.460928	2026-06-29 19:15:21.460928
253	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/TRACDAT2-datadisk-00	TRACDAT2-datadisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.463675	2026-06-29 19:15:21.463675
254	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/TRACDAT2-OSdisk-00	TRACDAT2-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.46641	2026-06-29 19:15:21.46641
255	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-TRACDAT2-00	nic-TRACDAT2-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.468993	2026-06-29 19:15:21.468993
256	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/TRACDAT2	TRACDAT2	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.471463	2026-06-29 19:15:21.471463
257	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/TRACDAT2/extensions/InplaceOSUpgrade	TRACDAT2/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.474033	2026-06-29 19:15:21.474033
258	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Compute/sshPublicKeys/test-gateway_key	test-gateway_key	Microsoft.Compute/sshPublicKeys	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.476739	2026-06-29 19:15:21.476739
259	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Network/networkSecurityGroups/test-gateway-nsg	test-gateway-nsg	Microsoft.Network/networkSecurityGroups	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.479023	2026-06-29 19:15:21.479023
260	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Network/virtualNetworks/test-gateway-vnet	test-gateway-vnet	Microsoft.Network/virtualNetworks	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.481695	2026-06-29 19:15:21.481695
261	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Compute/virtualMachines/test-gateway	test-gateway	Microsoft.Compute/virtualMachines	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.484099	2026-06-29 19:15:21.484099
262	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/TEST/providers/Microsoft.Compute/disks/test-gateway_OsDisk_1_0ebbb7c27fab4710b24153cea7a35d99	test-gateway_OsDisk_1_0ebbb7c27fab4710b24153cea7a35d99	Microsoft.Compute/disks	TEST	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.486542	2026-06-29 19:15:21.486542
263	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/microsoft.insights/actiongroups/RecommendedAlertRules-AG-3	RecommendedAlertRules-AG-3	microsoft.insights/actiongroups	test	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.489606	2026-06-29 19:15:21.489606
264	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Percentage CPU - test-gateway	Percentage CPU - test-gateway	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.492213	2026-06-29 19:15:21.492213
265	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Network In Total - test-gateway	Network In Total - test-gateway	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.495933	2026-06-29 19:15:21.495933
266	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Data Disk IOPS Consumed Percentage - test-gateway	Data Disk IOPS Consumed Percentage - test-gateway	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.498925	2026-06-29 19:15:21.498925
267	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Available Memory Bytes - test-gateway	Available Memory Bytes - test-gateway	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.501548	2026-06-29 19:15:21.501548
268	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Network Out Total - test-gateway	Network Out Total - test-gateway	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.504096	2026-06-29 19:15:21.504096
269	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/VM Availability - test-gateway	VM Availability - test-gateway	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.506621	2026-06-29 19:15:21.506621
270	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/OS Disk IOPS Consumed Percentage - test-gateway	OS Disk IOPS Consumed Percentage - test-gateway	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.509048	2026-06-29 19:15:21.509048
271	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/test-gateway139_z1	test-gateway139_z1	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.511566	2026-06-29 19:15:21.511566
272	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Storage/storageAccounts/migrate1d602lsa28895	migrate1d602lsa28895	Microsoft.Storage/storageAccounts	Hybr0d-Network	centralus	Storage	Standard_LRS	{"Migrate Project":"NutanixtoAzure"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.514109	2026-06-29 19:15:21.514109
273	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-lucas_fl-lucas_fl-246f832f-8cfc-4cb0-9672-a7710ef4cc23	asrseeddisk-lucas_fl-lucas_fl-246f832f-8cfc-4cb0-9672-a7710ef4cc23	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-d0bb45b1-76d6-5de7-a91e-9fd063e746de":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.516608	2026-06-29 19:15:21.516608
274	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/lucas-flare-OSdisk-01	lucas-flare-OSdisk-01	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.519406	2026-06-29 19:15:21.519406
275	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/lucas-flare	lucas-flare	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.523126	2026-06-29 19:15:21.523126
276	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.RecoveryServices/vaults/BACKUP	BACKUP	Microsoft.RecoveryServices/vaults	RG-Prod-CentralUS	centralus	\N	RS0	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.530539	2026-06-29 19:15:21.530539
277	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_KEYSTONE_158330485694760	AzureBackup_KEYSTONE_158330485694760	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.533053	2026-06-29 19:15:21.533053
278	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_WDS-New_158331741442512	AzureBackup_WDS-New_158331741442512	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.537348	2026-06-29 19:15:21.537348
279	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_GSYNC0_158330538047417	AzureBackup_GSYNC0_158330538047417	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.539782	2026-06-29 19:15:21.539782
280	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_XMAIL16_158330323939163	AzureBackup_XMAIL16_158330323939163	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.54277	2026-06-29 19:15:21.54277
281	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_TRACDAT2_158330477425830	AzureBackup_TRACDAT2_158330477425830	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.545515	2026-06-29 19:15:21.545515
282	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_KMS_158331007030149	AzureBackup_KMS_158331007030149	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.548388	2026-06-29 19:15:21.548388
283	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_PTEC2_158331106599706	AzureBackup_PTEC2_158331106599706	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.550982	2026-06-29 19:15:21.550982
284	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_EntraCloudConnect_158331001815983	AzureBackup_EntraCloudConnect_158331001815983	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.553587	2026-06-29 19:15:21.553587
285	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_SteamPT-License-Server_158331482695962	AzureBackup_SteamPT-License-Server_158331482695962	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.556242	2026-06-29 19:15:21.556242
286	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_Goverlan_158331799839364	AzureBackup_Goverlan_158331799839364	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.558776	2026-06-29 19:15:21.558776
287	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_COMPRESSORPT2_158331503177771	AzureBackup_COMPRESSORPT2_158331503177771	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.561134	2026-06-29 19:15:21.561134
288	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_ONERING16_158330235505095	AzureBackup_ONERING16_158330235505095	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.563637	2026-06-29 19:15:21.563637
289	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.DataProtection/BackupVaults/BACKUP-OS-Disk	BACKUP-OS-Disk	Microsoft.DataProtection/BackupVaults	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.568657	2026-06-29 19:15:21.568657
290	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-WEB_LIVE-WEB_LIVE-6589cd93-9a60-4917-ae98-37ef4ee1229d	asrseeddisk-WEB_LIVE-WEB_LIVE-6589cd93-9a60-4917-ae98-37ef4ee1229d	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-c3073aeb-11ef-54bf-92c4-2d04ccfc3fac":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.575922	2026-06-29 19:15:21.575922
291	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/WEB-LIVE2-OSdisk-00	WEB-LIVE2-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.580229	2026-06-29 19:15:21.580229
292	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-WEB-LIVE2-00	nic-WEB-LIVE2-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.583822	2026-06-29 19:15:21.583822
293	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-WEB-LIVE2-01	nic-WEB-LIVE2-01	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.586361	2026-06-29 19:15:21.586361
294	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WEB-LIVE2	WEB-LIVE2	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.589179	2026-06-29 19:15:21.589179
295	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WEB-LIVE2/extensions/InplaceOSUpgrade	WEB-LIVE2/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.593297	2026-06-29 19:15:21.593297
296	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_WEB-LIVE2_158330477693869	AzureBackup_WEB-LIVE2_158330477693869	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.596069	2026-06-29 19:15:21.596069
297	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/ciscodirectoryconnector816_z1	ciscodirectoryconnector816_z1	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.599083	2026-06-29 19:15:21.599083
298	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WEB-LIVE2/extensions/AdminCenter	WEB-LIVE2/AdminCenter	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.602947	2026-06-29 19:15:21.602947
299	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Available Memory Bytes - WSUS	Available Memory Bytes - WSUS	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.605976	2026-06-29 19:15:21.605976
300	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Data Disk IOPS Consumed Percentage - WSUS	Data Disk IOPS Consumed Percentage - WSUS	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.609064	2026-06-29 19:15:21.609064
301	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Percentage CPU - WSUS	Percentage CPU - WSUS	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.611577	2026-06-29 19:15:21.611577
302	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.ApplicationMigration/PGSQLSites/NutanixtoAzurepgsql	NutanixtoAzurepgsql	Microsoft.ApplicationMigration/PGSQLSites	Hybr0d-Network	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.614851	2026-06-29 19:15:21.614851
303	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.ApplicationMigration/PGSQLSites/VMAssessmentpgsql	VMAssessmentpgsql	Microsoft.ApplicationMigration/PGSQLSites	VMAssessment	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.617811	2026-06-29 19:15:21.617811
304	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-WEB-PHYSICAL-b6b65e39-722a-46bb-96ef-7e718da69b3b	asrseeddisk-WEB-PHYSICAL-b6b65e39-722a-46bb-96ef-7e718da69b3b	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-1c149621-c186-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.620447	2026-06-29 19:15:21.620447
305	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/WEB-OSdisk-00	WEB-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.623049	2026-06-29 19:15:21.623049
306	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-WEB-00	nic-WEB-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.626427	2026-06-29 19:15:21.626427
307	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WEB	WEB	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.629037	2026-06-29 19:15:21.629037
308	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WEB/extensions/InplaceOSUpgrade	WEB/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.63152	2026-06-29 19:15:21.63152
309	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-XMAIL16_-PHYSICAL-722507af-8991-4276-ac01-d200ddb356c6	asrseeddisk-XMAIL16_-PHYSICAL-722507af-8991-4276-ac01-d200ddb356c6	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-6fb20193-a093-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.634455	2026-06-29 19:15:21.634455
310	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-XMAIL16_-PHYSICAL-cfaf20b1-c406-4929-8d97-7596c4bf8788	asrseeddisk-XMAIL16_-PHYSICAL-cfaf20b1-c406-4929-8d97-7596c4bf8788	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-6fb20193-a093-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.637195	2026-06-29 19:15:21.637195
311	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-WEB-00-nsg	nic-WEB-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.639852	2026-06-29 19:15:21.639852
312	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-PRNTSP2-PHYSICAL-c346c575-3450-4cbf-b11e-bd1d5f895b5e	asrseeddisk-PRNTSP2-PHYSICAL-c346c575-3450-4cbf-b11e-bd1d5f895b5e	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-a79da5dc-c204-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.642585	2026-06-29 19:15:21.642585
313	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/publicIPAddresses/TestVM01-ip	TestVM01-ip	Microsoft.Network/publicIPAddresses	Hybr0d-Network	eastus2	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.647959	2026-06-29 19:15:21.647959
314	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/nic-lucas-flare-00	nic-lucas-flare-00	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.650655	2026-06-29 19:15:21.650655
315	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Network/bastionHosts/aadds-vnet-bastion	aadds-vnet-bastion	Microsoft.Network/bastionHosts	SCCC_Domain_services	centralus	\N	Developer	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.656147	2026-06-29 19:15:21.656147
316	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WEB-LIVE2/extensions/enablevmAccess	WEB-LIVE2/enablevmAccess	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.659224	2026-06-29 19:15:21.659224
317	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/PRNTSP2-OSdisk-00	PRNTSP2-OSdisk-00	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.661827	2026-06-29 19:15:21.661827
318	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-PRNTSP2-00	nic-PRNTSP2-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.664378	2026-06-29 19:15:21.664378
319	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/PRNTSP2	PRNTSP2	Microsoft.Compute/virtualMachines	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.667036	2026-06-29 19:15:21.667036
320	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/PRNTSP2/extensions/InplaceOSUpgrade	PRNTSP2/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.670237	2026-06-29 19:15:21.670237
321	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/XMAIL16-New-datadisk-00	XMAIL16-New-datadisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.673589	2026-06-29 19:15:21.673589
322	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/XMAIL16-New-OSdisk-00	XMAIL16-New-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.676432	2026-06-29 19:15:21.676432
323	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Network/networkInterfaces/nic-XMAIL16-New-00	nic-XMAIL16-New-00	Microsoft.Network/networkInterfaces	HYBR0D-NETWORK	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.679205	2026-06-29 19:15:21.679205
324	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/XMAIL16-New	XMAIL16-New	Microsoft.Compute/virtualMachines	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.683257	2026-06-29 19:15:21.683257
325	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/XMAIL16-New/extensions/InplaceOSUpgrade	XMAIL16-New/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.685851	2026-06-29 19:15:21.685851
326	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-MFS0-PHYSICAL-418a3287-e756-4ccb-86b7-6e9ada6506ba	asrseeddisk-MFS0-PHYSICAL-418a3287-e756-4ccb-86b7-6e9ada6506ba	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-664112ce-cbe2-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.68891	2026-06-29 19:15:21.68891
327	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-MFS0-PHYSICAL-c72f2c2a-bf9c-4296-ba4f-6ced23facf56	asrseeddisk-MFS0-PHYSICAL-c72f2c2a-bf9c-4296-ba4f-6ced23facf56	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-664112ce-cbe2-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.691576	2026-06-29 19:15:21.691576
328	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-MFS0-PHYSICAL-55637da9-cea5-4284-8992-6895f02f8313	asrseeddisk-MFS0-PHYSICAL-55637da9-cea5-4284-8992-6895f02f8313	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-664112ce-cbe2-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.69506	2026-06-29 19:15:21.69506
329	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-MFS0-PHYSICAL-f1e3cd52-fded-4af2-8339-606e5c970a69	asrseeddisk-MFS0-PHYSICAL-f1e3cd52-fded-4af2-8339-606e5c970a69	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-664112ce-cbe2-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.697869	2026-06-29 19:15:21.697869
330	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-AD_SC01-PHYSICAL-1587eaa1-cb16-444f-99eb-3ae44043b28d	asrseeddisk-AD_SC01-PHYSICAL-1587eaa1-cb16-444f-99eb-3ae44043b28d	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-19d52a54-cbe3-11f0-b178-506b8da990f1":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.700764	2026-06-29 19:15:21.700764
331	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/XMAIL16-New/extensions/enablevmAccess	XMAIL16-New/enablevmAccess	Microsoft.Compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.703687	2026-06-29 19:15:21.703687
332	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_XMAIL16-New_158331611766579	AzureBackup_XMAIL16-New_158331611766579	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.706806	2026-06-29 19:15:21.706806
333	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_PRNTSP2_158331322713542	AzureBackup_PRNTSP2_158331322713542	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.709212	2026-06-29 19:15:21.709212
334	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/MFS0-OSdisk-00	MFS0-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.711833	2026-06-29 19:15:21.711833
335	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/MFS0-datadisk-00	MFS0-datadisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.715177	2026-06-29 19:15:21.715177
336	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/MFS0-datadisk-00-40290077-d056-463c-9b7f-297acbc00071	MFS0-datadisk-00-40290077-d056-463c-9b7f-297acbc00071	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.718272	2026-06-29 19:15:21.718272
337	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/MFS0-datadisk-00-cf2194b6-21ee-47e4-94c6-72173f21ffc3	MFS0-datadisk-00-cf2194b6-21ee-47e4-94c6-72173f21ffc3	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.720997	2026-06-29 19:15:21.720997
338	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-MFS0-01	nic-MFS0-01	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.724248	2026-06-29 19:15:21.724248
339	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-MFS0-00	nic-MFS0-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.726883	2026-06-29 19:15:21.726883
340	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/MFS0	MFS0	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.729614	2026-06-29 19:15:21.729614
341	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/MFS0/extensions/InplaceOSUpgrade	MFS0/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.732081	2026-06-29 19:15:21.732081
342	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/AD-SC01-OSdisk-00	AD-SC01-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Site Recovery"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.734845	2026-06-29 19:15:21.734845
343	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-AD-SC01-00	nic-AD-SC01-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.737373	2026-06-29 19:15:21.737373
344	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/AD-SC01	AD-SC01	Microsoft.Compute/virtualMachines	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.740057	2026-06-29 19:15:21.740057
345	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/AD-SC01/extensions/InplaceOSUpgrade	AD-SC01/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.742534	2026-06-29 19:15:21.742534
346	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_AD-SC01_158331064702849	AzureBackup_AD-SC01_158331064702849	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.747769	2026-06-29 19:15:21.747769
347	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_MFS0_158331344747714	AzureBackup_MFS0_158331344747714	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.751304	2026-06-29 19:15:21.751304
348	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/WAC-nsg	WAC-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.754254	2026-06-29 19:15:21.754254
349	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/wac163_z1	wac163_z1	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.757642	2026-06-29 19:15:21.757642
350	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WAC	WAC	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.760209	2026-06-29 19:15:21.760209
351	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/WAC_OsDisk_1_49a97a8f53b14bd19155439c7f7f19b8	WAC_OsDisk_1_49a97a8f53b14bd19155439c7f7f19b8	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.762689	2026-06-29 19:15:21.762689
352	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-SalonIRI-SalonIRI-34f65f5c-59a6-4449-ab97-54260aab0c7b	asrseeddisk-SalonIRI-SalonIRI-34f65f5c-59a6-4449-ab97-54260aab0c7b	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-f3b9e52f-5e96-5a64-9aee-e856ba64463a":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.76551	2026-06-29 19:15:21.76551
353	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_WAC_158331423483906	AzureBackup_WAC_158331423483906	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.767986	2026-06-29 19:15:21.767986
354	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/SalonIRIS-OSdisk-00	SalonIRIS-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.77076	2026-06-29 19:15:21.77076
355	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-SalonIRIS-00	nic-SalonIRIS-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.773178	2026-06-29 19:15:21.773178
356	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/SalonIRIS	SalonIRIS	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.775787	2026-06-29 19:15:21.775787
357	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/SalonIRIS/extensions/InplaceOSUpgrade	SalonIRIS/InplaceOSUpgrade	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.778972	2026-06-29 19:15:21.778972
358	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-Barracud-Barracud-5c89c809-af61-4bf8-9fe5-73709646dd0b	asrseeddisk-Barracud-Barracud-5c89c809-af61-4bf8-9fe5-73709646dd0b	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-84850256-9fab-5967-8ffb-dbbfa0488295":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.781983	2026-06-29 19:15:21.781983
359	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-sc_duopr-sc_duopr-39fe0773-8d73-47f8-ad7b-9cff40212bb7	asrseeddisk-sc_duopr-sc_duopr-39fe0773-8d73-47f8-ad7b-9cff40212bb7	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-98b1a70e-b8d0-503c-a7a6-e8a74e69bc3c":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.784881	2026-06-29 19:15:21.784881
360	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-sc_duopr-sc_duopr-43b6bc07-9fc7-4a1e-81d4-8ddf6491e76a	asrseeddisk-sc_duopr-sc_duopr-43b6bc07-9fc7-4a1e-81d4-8ddf6491e76a	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-98b1a70e-b8d0-503c-a7a6-e8a74e69bc3c":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.78753	2026-06-29 19:15:21.78753
421	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Dashboard/grafana/Dashboard-grafana	Dashboard-grafana	Microsoft.Dashboard/grafana	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.977057	2026-06-29 19:15:21.977057
361	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-Syslog_F-Syslog_F-842124b1-d9bd-4c42-9741-1fdf24245b28	asrseeddisk-Syslog_F-Syslog_F-842124b1-d9bd-4c42-9741-1fdf24245b28	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-1f50808c-9300-5e04-b654-82ce1e360103":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.790299	2026-06-29 19:15:21.790299
362	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/Syslog-Forwarder-OSdisk-00	Syslog-Forwarder-OSdisk-00	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Standard_LRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.793011	2026-06-29 19:15:21.793011
363	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/nic-Syslog-Forwarder-00	nic-Syslog-Forwarder-00	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.795852	2026-06-29 19:15:21.795852
364	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/Syslog-Forwarder	Syslog-Forwarder	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.798538	2026-06-29 19:15:21.798538
365	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Network/networkSecurityGroups/nsg-xmail16-new	nsg-xmail16-new	Microsoft.Network/networkSecurityGroups	HYBR0D-NETWORK	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.800971	2026-06-29 19:15:21.800971
366	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/virtualNetworks/vnet-prod-web	vnet-prod-web	Microsoft.Network/virtualNetworks	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.803447	2026-06-29 19:15:21.803447
367	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/nsg-prod-web	nsg-prod-web	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.806112	2026-06-29 19:15:21.806112
368	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/nic-PROD-IIS-WEB01	nic-PROD-IIS-WEB01	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.808577	2026-06-29 19:15:21.808577
369	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/PROD-IIS-WEB01	PROD-IIS-WEB01	Microsoft.Compute/virtualMachines	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.812379	2026-06-29 19:15:21.812379
370	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/disks/osdisk-PROD-IIS-WEB01	osdisk-PROD-IIS-WEB01	Microsoft.Compute/disks	RG-PROD-CENTRALUS	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.817753	2026-06-29 19:15:21.817753
371	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/PROD-IIS-WEB01/extensions/CustomScriptExtension	PROD-IIS-WEB01/CustomScriptExtension	Microsoft.Compute/virtualMachines/extensions	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.825631	2026-06-29 19:15:21.825631
372	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/sshPublicKeys/trendmicro-new	trendmicro-new	Microsoft.Compute/sshPublicKeys	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.828558	2026-06-29 19:15:21.828558
373	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/new-trendmicroa640_z1	new-trendmicroa640_z1	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.831058	2026-06-29 19:15:21.831058
374	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/New-TrendMicroA	New-TrendMicroA	Microsoft.Compute/virtualMachines	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.836943	2026-06-29 19:15:21.836943
375	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/New-TrendMicroA_lun_0_2_a9c4a4ec4b3c4421b26c4e8d73f74afe	New-TrendMicroA_lun_0_2_a9c4a4ec4b3c4421b26c4e8d73f74afe	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.840648	2026-06-29 19:15:21.840648
376	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/New-TrendMicroA_OsDisk_1_ac4fa81f88204bd09f6ac94e3457f3d0	New-TrendMicroA_OsDisk_1_ac4fa81f88204bd09f6ac94e3457f3d0	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.843573	2026-06-29 19:15:21.843573
377	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/new-trendmicroa640_z1-nsg	new-trendmicroa640_z1-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.845842	2026-06-29 19:15:21.845842
378	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.ApplicationMigration/StorageSites/VMAssessmentstorage	VMAssessmentstorage	Microsoft.ApplicationMigration/StorageSites	VMAssessment	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.848926	2026-06-29 19:15:21.848926
379	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/XMAIL16-New/extensions/AdminCenter	XMAIL16-New/AdminCenter	Microsoft.Compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.851941	2026-06-29 19:15:21.851941
380	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/sshPublicKeys/NewRSA	NewRSA	Microsoft.Compute/sshPublicKeys	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.854547	2026-06-29 19:15:21.854547
381	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/dataCollectionRules/MSVMI-centralus-new-trendmicroa	MSVMI-centralus-new-trendmicroa	Microsoft.Insights/dataCollectionRules	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.858158	2026-06-29 19:15:21.858158
382	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/defaultresourcegroup-cus/providers/microsoft.monitor/accounts/defaultazuremonitorworkspace-cus	defaultazuremonitorworkspace-cus	microsoft.monitor/accounts	defaultresourcegroup-cus	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.860782	2026-06-29 19:15:21.860782
383	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/MA_defaultazuremonitorworkspace-cus_centralus_managed/providers/Microsoft.Insights/dataCollectionEndpoints/defaultazuremonitorworkspace-cus	defaultazuremonitorworkspace-cus	Microsoft.Insights/dataCollectionEndpoints	MA_defaultazuremonitorworkspace-cus_centralus_managed	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.864226	2026-06-29 19:15:21.864226
384	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/MA_defaultazuremonitorworkspace-cus_centralus_managed/providers/Microsoft.Insights/dataCollectionRules/defaultazuremonitorworkspace-cus	defaultazuremonitorworkspace-cus	Microsoft.Insights/dataCollectionRules	MA_defaultazuremonitorworkspace-cus_centralus_managed	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.867361	2026-06-29 19:15:21.867361
385	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/dataCollectionRules/MSVMOtel-centralus-new-trendmicroa	MSVMOtel-centralus-new-trendmicroa	Microsoft.Insights/dataCollectionRules	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.869846	2026-06-29 19:15:21.869846
386	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/microsoft.compute/virtualMachines/new-trendmicroa/extensions/AzureMonitorLinuxAgent	new-trendmicroa/AzureMonitorLinuxAgent	microsoft.compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.872411	2026-06-29 19:15:21.872411
387	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/dataCollectionRules/MSVMI-centralus-ad-sc01	MSVMI-centralus-ad-sc01	Microsoft.Insights/dataCollectionRules	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.875185	2026-06-29 19:15:21.875185
388	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/dataCollectionRules/MSVMOtel-centralus-ad-sc01	MSVMOtel-centralus-ad-sc01	Microsoft.Insights/dataCollectionRules	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.878052	2026-06-29 19:15:21.878052
389	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/microsoft.compute/virtualMachines/ad-sc01/extensions/AzureMonitorWindowsAgent	ad-sc01/AzureMonitorWindowsAgent	microsoft.compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.884648	2026-06-29 19:15:21.884648
390	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/AD-SC01/extensions/HealthExtension	AD-SC01/HealthExtension	Microsoft.Compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.887565	2026-06-29 19:15:21.887565
391	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/AD-SC01/extensions/Microsoft.Insights.VMDiagnosticsSettings	AD-SC01/Microsoft.Insights.VMDiagnosticsSettings	Microsoft.Compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.89034	2026-06-29 19:15:21.89034
392	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_DOMAIN_SERVICES/providers/Microsoft.Compute/virtualMachines/AzADC001/extensions/HealthExtension	AzADC001/HealthExtension	Microsoft.Compute/virtualMachines/extensions	SCCC_DOMAIN_SERVICES	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.893988	2026-06-29 19:15:21.893988
393	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/dataCollectionRules/MSVMI-centralus-entracloudconnect	MSVMI-centralus-entracloudconnect	Microsoft.Insights/dataCollectionRules	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.897194	2026-06-29 19:15:21.897194
394	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/dataCollectionRules/MSVMOtel-centralus-entracloudconnect	MSVMOtel-centralus-entracloudconnect	Microsoft.Insights/dataCollectionRules	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.901056	2026-06-29 19:15:21.901056
395	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/microsoft.compute/virtualMachines/entracloudconnect/extensions/AzureMonitorWindowsAgent	entracloudconnect/AzureMonitorWindowsAgent	microsoft.compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.903689	2026-06-29 19:15:21.903689
396	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Dashboard/dashboards/Dashboard-02-18-2026-12-13	Dashboard-02-18-2026-12-13	Microsoft.Dashboard/dashboards	RG-Prod-CentralUS	centralus	\N	\N	{"GrafanaDashboardTags":"","AzMonGrafanaDashboardId":"InfrastructureResourcesOverview###ver###3","GrafanaDashboardResourceType":"Azure Monitor"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.906474	2026-06-29 19:15:21.906474
397	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Dashboard/grafana/NetworkMonitor	NetworkMonitor	Microsoft.Dashboard/grafana	AzureBackupRG_centralus_1	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.909112	2026-06-29 19:15:21.909112
398	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/privateEndpoints/Influx	Influx	Microsoft.Network/privateEndpoints	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.911809	2026-06-29 19:15:21.911809
399	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/Influx-nic	Influx-nic	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.914517	2026-06-29 19:15:21.914517
400	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybrid-TEST01_group/providers/Microsoft.Network/privateDnsZones/privatelink.grafana.azure.com	privatelink.grafana.azure.com	Microsoft.Network/privateDnsZones	Hybrid-TEST01_group	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.917382	2026-06-29 19:15:21.917382
401	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybrid-TEST01_group/providers/Microsoft.Network/privateDnsZones/privatelink.grafana.azure.com/virtualNetworkLinks/psqgglhfw7mq4	privatelink.grafana.azure.com/psqgglhfw7mq4	Microsoft.Network/privateDnsZones/virtualNetworkLinks	Hybrid-TEST01_group	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.91997	2026-06-29 19:15:21.91997
402	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/PRNTSP2/extensions/HealthExtension	PRNTSP2/HealthExtension	Microsoft.Compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.922687	2026-06-29 19:15:21.922687
403	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/microsoft.insights/actiongroups/Alert Group	Alert Group	microsoft.insights/actiongroups	RG-Prod-CentralUS	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.925277	2026-06-29 19:15:21.925277
404	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/microsoft.insights/metricalerts/Tunnel Bandwith	Tunnel Bandwith	microsoft.insights/metricalerts	RG-Prod-CentralUS	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.928009	2026-06-29 19:15:21.928009
405	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/metricalerts/Network In Total - compressorpt2	Network In Total - compressorpt2	Microsoft.Insights/metricalerts	hybr0d-network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.930632	2026-06-29 19:15:21.930632
406	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/metricalerts/Data Disk IOPS Consumed Percentage - compressorpt2	Data Disk IOPS Consumed Percentage - compressorpt2	Microsoft.Insights/metricalerts	hybr0d-network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.933204	2026-06-29 19:15:21.933204
407	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/metricalerts/VM Availability - compressorpt2	VM Availability - compressorpt2	Microsoft.Insights/metricalerts	hybr0d-network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.936751	2026-06-29 19:15:21.936751
408	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/metricalerts/Percentage CPU - compressorpt2	Percentage CPU - compressorpt2	Microsoft.Insights/metricalerts	hybr0d-network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.939473	2026-06-29 19:15:21.939473
409	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/metricalerts/Available Memory Bytes - compressorpt2	Available Memory Bytes - compressorpt2	Microsoft.Insights/metricalerts	hybr0d-network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.943875	2026-06-29 19:15:21.943875
410	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/metricalerts/Network Out Total - compressorpt2	Network Out Total - compressorpt2	Microsoft.Insights/metricalerts	hybr0d-network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.946587	2026-06-29 19:15:21.946587
411	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/metricalerts/OS Disk IOPS Consumed Percentage - compressorpt2	OS Disk IOPS Consumed Percentage - compressorpt2	Microsoft.Insights/metricalerts	hybr0d-network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.949004	2026-06-29 19:15:21.949004
412	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Percentage CPU - XMAIL16-New	Percentage CPU - XMAIL16-New	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.951581	2026-06-29 19:15:21.951581
413	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/OS Disk IOPS Consumed Percentage - XMAIL16-New	OS Disk IOPS Consumed Percentage - XMAIL16-New	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.953979	2026-06-29 19:15:21.953979
414	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Network Out Total - XMAIL16-New	Network Out Total - XMAIL16-New	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.956949	2026-06-29 19:15:21.956949
415	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Network In Total - XMAIL16-New	Network In Total - XMAIL16-New	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.959615	2026-06-29 19:15:21.959615
416	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/VM Availability - XMAIL16-New	VM Availability - XMAIL16-New	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.962359	2026-06-29 19:15:21.962359
417	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Data Disk IOPS Consumed Percentage - XMAIL16-New	Data Disk IOPS Consumed Percentage - XMAIL16-New	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.96507	2026-06-29 19:15:21.96507
418	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Available Memory Bytes - XMAIL16-New	Available Memory Bytes - XMAIL16-New	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.967877	2026-06-29 19:15:21.967877
419	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/microsoft.insights/metricalerts/VM Down	VM Down	microsoft.insights/metricalerts	Hybr0d-Network	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.971018	2026-06-29 19:15:21.971018
420	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/microsoft.insights/activityLogAlerts/service health quick alert	service health quick alert	microsoft.insights/activityLogAlerts	AzureBackupRG_centralus_1	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.973809	2026-06-29 19:15:21.973809
422	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybrid-TEST01_group/providers/Microsoft.Network/privateDnsZones/privatelink.grafana.azure.com/virtualNetworkLinks/g2rs477nigxeq	privatelink.grafana.azure.com/g2rs477nigxeq	Microsoft.Network/privateDnsZones/virtualNetworkLinks	Hybrid-TEST01_group	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.980719	2026-06-29 19:15:21.980719
423	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/privateEndpoints/grafanasubnet	grafanasubnet	Microsoft.Network/privateEndpoints	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.983669	2026-06-29 19:15:21.983669
424	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/grafanasubnet.nic.fde3caa2-445a-4eee-8209-00f72c57959e	grafanasubnet.nic.fde3caa2-445a-4eee-8209-00f72c57959e	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.986534	2026-06-29 19:15:21.986534
425	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/loadBalancers/influx-ilb	influx-ilb	Microsoft.Network/loadBalancers	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.989251	2026-06-29 19:15:21.989251
426	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/privateLinkServices/influx-pls	influx-pls	Microsoft.Network/privateLinkServices	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.992286	2026-06-29 19:15:21.992286
427	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkInterfaces/influx-pls.nic.0caf4d6d-a1a9-433e-9e77-f3a83f71967e	influx-pls.nic.0caf4d6d-a1a9-433e-9e77-f3a83f71967e	Microsoft.Network/networkInterfaces	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.995258	2026-06-29 19:15:21.995258
428	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Dashboard/grafana/Dashboard-grafana/managedPrivateEndpoints/GrafanaPrivateend	Dashboard-grafana/GrafanaPrivateend	Microsoft.Dashboard/grafana/managedPrivateEndpoints	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:21.99841	2026-06-29 19:15:21.99841
429	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Network/privateDnsZones/centralus.azure.privatelinkservice	centralus.azure.privatelinkservice	Microsoft.Network/privateDnsZones	AzureBackupRG_centralus_1	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.001445	2026-06-29 19:15:22.001445
430	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/ONERING16-OSdisk-00-Snapshot	ONERING16-OSdisk-00-Snapshot	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.006265	2026-06-29 19:15:22.006265
431	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/ONERING16-new-nsg	ONERING16-new-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.008756	2026-06-29 19:15:22.008756
432	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Network Out Total - ONERING16-new	Network Out Total - ONERING16-new	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.011542	2026-06-29 19:15:22.011542
433	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/VM Availability - ONERING16-new	VM Availability - ONERING16-new	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.014239	2026-06-29 19:15:22.014239
434	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Network In Total - ONERING16-new	Network In Total - ONERING16-new	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.019468	2026-06-29 19:15:22.019468
435	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Available Memory Bytes - ONERING16-new	Available Memory Bytes - ONERING16-new	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.022049	2026-06-29 19:15:22.022049
436	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/OS Disk IOPS Consumed Percentage - ONERING16-new	OS Disk IOPS Consumed Percentage - ONERING16-new	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.028439	2026-06-29 19:15:22.028439
437	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Percentage CPU - ONERING16-new	Percentage CPU - ONERING16-new	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.031339	2026-06-29 19:15:22.031339
438	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Data Disk IOPS Consumed Percentage - ONERING16-new	Data Disk IOPS Consumed Percentage - ONERING16-new	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.03387	2026-06-29 19:15:22.03387
439	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/WSUS/extensions/AzureMonitorWindowsAgent	WSUS/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	HYBR0D-NETWORK	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.036115	2026-06-29 19:15:22.036115
440	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/Goverlan/extensions/AzureMonitorWindowsAgent	Goverlan/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.038802	2026-06-29 19:15:22.038802
461	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-COMPRESSORPT2-00-nsg	nic-COMPRESSORPT2-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.097834	2026-06-29 19:15:22.097834
441	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/COMPRESSORPT2/extensions/AzureMonitorWindowsAgent	COMPRESSORPT2/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.041326	2026-06-29 19:15:22.041326
442	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/KEYSTONE/extensions/AzureMonitorWindowsAgent	KEYSTONE/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.043983	2026-06-29 19:15:22.043983
443	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/netedit/extensions/AzureMonitorLinuxAgent	netedit/AzureMonitorLinuxAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.046953	2026-06-29 19:15:22.046953
444	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/MFS0/extensions/AzureMonitorWindowsAgent	MFS0/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.050249	2026-06-29 19:15:22.050249
445	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/GSYNC0/extensions/AzureMonitorWindowsAgent	GSYNC0/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.054177	2026-06-29 19:15:22.054177
446	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/TRACDAT2/extensions/AzureMonitorWindowsAgent	TRACDAT2/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.057187	2026-06-29 19:15:22.057187
447	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/Syslog-Forwarder/extensions/AzureMonitorLinuxAgent	Syslog-Forwarder/AzureMonitorLinuxAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.05963	2026-06-29 19:15:22.05963
448	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/SCCCMFS01/extensions/AzureMonitorWindowsAgent	SCCCMFS01/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.062208	2026-06-29 19:15:22.062208
449	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/SteamPT-License-Server/extensions/AzureMonitorWindowsAgent	SteamPT-License-Server/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.06489	2026-06-29 19:15:22.06489
450	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/ONERING16/extensions/AzureMonitorWindowsAgent	ONERING16/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.068145	2026-06-29 19:15:22.068145
451	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/PRNTSP2/extensions/AzureMonitorWindowsAgent	PRNTSP2/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.070639	2026-06-29 19:15:22.070639
452	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/PTEC2/extensions/AzureMonitorWindowsAgent	PTEC2/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.07341	2026-06-29 19:15:22.07341
453	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/SalonIRIS/extensions/AzureMonitorWindowsAgent	SalonIRIS/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.076218	2026-06-29 19:15:22.076218
454	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WAC/extensions/AzureMonitorWindowsAgent	WAC/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.078846	2026-06-29 19:15:22.078846
455	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WEB-LIVE2/extensions/AzureMonitorWindowsAgent	WEB-LIVE2/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.081376	2026-06-29 19:15:22.081376
456	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/TRENDV1SVCGW/extensions/AzureMonitorLinuxAgent	TRENDV1SVCGW/AzureMonitorLinuxAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.083854	2026-06-29 19:15:22.083854
457	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WEB/extensions/AzureMonitorWindowsAgent	WEB/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.086441	2026-06-29 19:15:22.086441
458	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/XMAIL16-New/extensions/AzureMonitorWindowsAgent	XMAIL16-New/AzureMonitorWindowsAgent	Microsoft.Compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.089218	2026-06-29 19:15:22.089218
459	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-ONERING16-00-nsg	nic-ONERING16-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.091955	2026-06-29 19:15:22.091955
460	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-AD-SC01-00-nsg	nic-AD-SC01-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.094649	2026-06-29 19:15:22.094649
462	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-EntraCloudConnect-00-nsg	nic-EntraCloudConnect-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.10362	2026-06-29 19:15:22.10362
463	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-Goverlan-00-nsg	nic-Goverlan-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.10815	2026-06-29 19:15:22.10815
464	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-GSYNC0-00-nsg	nic-GSYNC0-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.113552	2026-06-29 19:15:22.113552
465	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-KEYSTONE-00-nsg	nic-KEYSTONE-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.118073	2026-06-29 19:15:22.118073
466	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-LUCAS-KALI-00-nsg	nic-LUCAS-KALI-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.122074	2026-06-29 19:15:22.122074
467	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-MFS0-01-nsg	nic-MFS0-01-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.129609	2026-06-29 19:15:22.129609
468	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-netedit-00-nsg	nic-netedit-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.132402	2026-06-29 19:15:22.132402
469	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-PRNTSP2-00-nsg	nic-PRNTSP2-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.134981	2026-06-29 19:15:22.134981
470	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-PTEC2-00-nsg	nic-PTEC2-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.137543	2026-06-29 19:15:22.137543
471	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-SalonIRIS-00-nsg	nic-SalonIRIS-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.140598	2026-06-29 19:15:22.140598
472	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-SteamPT-License-Server-00-nsg	nic-SteamPT-License-Server-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.143245	2026-06-29 19:15:22.143245
473	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-Syslog-Forwarder-00-nsg	nic-Syslog-Forwarder-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.146021	2026-06-29 19:15:22.146021
474	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-TRACDAT2-00-nsg	nic-TRACDAT2-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.149112	2026-06-29 19:15:22.149112
475	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/nic-TRENDV1SVCGW-00-nsg	nic-TRENDV1SVCGW-00-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.152088	2026-06-29 19:15:22.152088
476	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/networkSecurityGroups/nic-WDS-New-00-nsg	nic-WDS-New-00-nsg	Microsoft.Network/networkSecurityGroups	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.155043	2026-06-29 19:15:22.155043
477	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WDS-New	WDS-New	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.157968	2026-06-29 19:15:22.157968
478	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/WDS-New/extensions/MDE.Windows	WDS-New/MDE.Windows	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.160937	2026-06-29 19:15:22.160937
479	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/CiscoDirectoryConnector	CiscoDirectoryConnector	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.16396	2026-06-29 19:15:22.16396
480	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/CiscoDirectoryConnector/extensions/HealthExtension	CiscoDirectoryConnector/HealthExtension	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.166543	2026-06-29 19:15:22.166543
481	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/CiscoDirectoryConnector/extensions/enablevmAccess	CiscoDirectoryConnector/enablevmAccess	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.169205	2026-06-29 19:15:22.169205
482	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Storage/storageAccounts/influx	influx	Microsoft.Storage/storageAccounts	Hybr0d-Network	centralus	StorageV2	Standard_GRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.172138	2026-06-29 19:15:22.172138
483	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_Domain_services/providers/Microsoft.Compute/virtualMachines/IIS-VM/extensions/enablevmAccess	IIS-VM/enablevmAccess	Microsoft.Compute/virtualMachines/extensions	SCCC_Domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.178807	2026-06-29 19:15:22.178807
484	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/bastionHosts/Hybrid-VNet-bastion	Hybrid-VNet-bastion	Microsoft.Network/bastionHosts	RG-Prod-CentralUS	centralus	\N	Developer	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.181554	2026-06-29 19:15:22.181554
485	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/sccc_domain_services/providers/Microsoft.Network/dnszones/sccc.edu	sccc.edu	Microsoft.Network/dnszones	sccc_domain_services	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.184643	2026-06-29 19:15:22.184643
486	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/publicIPAddresses/Hybrid-NatGW-PIP01	Hybrid-NatGW-PIP01	Microsoft.Network/publicIPAddresses	Hybr0d-Network	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.187581	2026-06-29 19:15:22.187581
487	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/natGateways/Hybrid-NatGW01	Hybrid-NatGW01	Microsoft.Network/natGateways	Hybr0d-Network	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.190067	2026-06-29 19:15:22.190067
488	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Network/natGateways/Hybrid-NatGW01	Hybrid-NatGW01	Microsoft.Network/natGateways	RG-Prod-CentralUS	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.192468	2026-06-29 19:15:22.192468
489	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_Syslog-Forwarder_158330044275956	AzureBackup_Syslog-Forwarder_158330044275956	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.194926	2026-06-29 19:15:22.194926
490	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_SalonIRIS_158330023360528	AzureBackup_SalonIRIS_158330023360528	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.197203	2026-06-29 19:15:22.197203
491	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/AzureBackupRG_centralus_1/providers/Microsoft.Compute/restorePointCollections/AzureBackup_New-TrendMicroA_158331271975412	AzureBackup_New-TrendMicroA_158331271975412	Microsoft.Compute/restorePointCollections	AzureBackupRG_centralus_1	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.199534	2026-06-29 19:15:22.199534
492	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.CognitiveServices/accounts/test-document-i	test-document-i	Microsoft.CognitiveServices/accounts	Hybr0d-Network	eastus	FormRecognizer	F0	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.202014	2026-06-29 19:15:22.202014
493	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.CognitiveServices/accounts/test-speech2text	test-speech2text	Microsoft.CognitiveServices/accounts	Hybr0d-Network	eastus	SpeechServices	F0	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.205181	2026-06-29 19:15:22.205181
494	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-04-13T05-30-50.7334697	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-04-13T05-30-50.7334697	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.207936	2026-06-29 19:15:22.207936
495	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-04-13T05-30-51.3016763	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-04-13T05-30-51.3016763	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.210374	2026-06-29 19:15:22.210374
496	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-04-13T05-30-59.1928211	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-04-13T05-30-59.1928211	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.212839	2026-06-29 19:15:22.212839
497	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-04-13T05-31-00.6774664	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-04-13T05-31-00.6774664	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.215996	2026-06-29 19:15:22.215996
498	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-04-13T05-31-01.5852462	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-04-13T05-31-01.5852462	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.218538	2026-06-29 19:15:22.218538
499	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-04-20T05-30-42.7239021	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-04-20T05-30-42.7239021	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.222587	2026-06-29 19:15:22.222587
500	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-04-20T05-30-45.6376250	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-04-20T05-30-45.6376250	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.225254	2026-06-29 19:15:22.225254
519	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/PROD-IIS-WEB01/extensions/enablevmAccess	PROD-IIS-WEB01/enablevmAccess	Microsoft.Compute/virtualMachines/extensions	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.294193	2026-06-29 19:15:22.294193
501	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-04-20T05-30-53.4243642	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-04-20T05-30-53.4243642	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.233189	2026-06-29 19:15:22.233189
502	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-04-20T05-30-56.1434195	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-04-20T05-30-56.1434195	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.236673	2026-06-29 19:15:22.236673
503	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-04-20T05-30-58.1872759	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-04-20T05-30-58.1872759	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.240108	2026-06-29 19:15:22.240108
504	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/sccc_domain_services/providers/Microsoft.Insights/dataCollectionRules/MSVMI-centralus-iis-vm	MSVMI-centralus-iis-vm	Microsoft.Insights/dataCollectionRules	sccc_domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.242914	2026-06-29 19:15:22.242914
505	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/sccc_domain_services/providers/Microsoft.Insights/dataCollectionRules/MSVMOtel-centralus-iis-vm	MSVMOtel-centralus-iis-vm	Microsoft.Insights/dataCollectionRules	sccc_domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.246453	2026-06-29 19:15:22.246453
506	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/sccc_domain_services/providers/microsoft.compute/virtualMachines/iis-vm/extensions/AzureMonitorWindowsAgent	iis-vm/AzureMonitorWindowsAgent	microsoft.compute/virtualMachines/extensions	sccc_domain_services	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.249826	2026-06-29 19:15:22.249826
507	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkSecurityGroups/Barracuda-Replacement-nsg	Barracuda-Replacement-nsg	Microsoft.Network/networkSecurityGroups	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.2541	2026-06-29 19:15:22.2541
508	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/barracuda-replacement617_z1	barracuda-replacement617_z1	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.257607	2026-06-29 19:15:22.257607
509	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/microsoft.insights/actiongroups/RecommendedAlertRules-AG-3	RecommendedAlertRules-AG-3	microsoft.insights/actiongroups	Hybr0d-Network	global	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.26098	2026-06-29 19:15:22.26098
510	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/Barracuda-Replacement	Barracuda-Replacement	Microsoft.Compute/virtualMachines	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.263937	2026-06-29 19:15:22.263937
511	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/disks/Barracuda-Replacement_OsDisk_1_ab4b0fa0db0f4b37bc3a1699b5f15f39	Barracuda-Replacement_OsDisk_1_ab4b0fa0db0f4b37bc3a1699b5f15f39	Microsoft.Compute/disks	HYBR0D-NETWORK	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.269978	2026-06-29 19:15:22.269978
512	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/OS Disk IOPS Consumed Percentage - Barracuda-Replacement	OS Disk IOPS Consumed Percentage - Barracuda-Replacement	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.27318	2026-06-29 19:15:22.27318
513	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Percentage CPU - Barracuda-Replacement	Percentage CPU - Barracuda-Replacement	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.275874	2026-06-29 19:15:22.275874
514	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Available Memory Bytes - Barracuda-Replacement	Available Memory Bytes - Barracuda-Replacement	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.278348	2026-06-29 19:15:22.278348
515	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Network In Total - Barracuda-Replacement	Network In Total - Barracuda-Replacement	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.280715	2026-06-29 19:15:22.280715
516	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Data Disk IOPS Consumed Percentage - Barracuda-Replacement	Data Disk IOPS Consumed Percentage - Barracuda-Replacement	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.285288	2026-06-29 19:15:22.285288
517	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/Network Out Total - Barracuda-Replacement	Network Out Total - Barracuda-Replacement	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.287916	2026-06-29 19:15:22.287916
518	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Insights/metricalerts/VM Availability - Barracuda-Replacement	VM Availability - Barracuda-Replacement	Microsoft.Insights/metricalerts	Hybr0d-Network	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.290361	2026-06-29 19:15:22.290361
520	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/Hybrid-testVm01/extensions/enablevmAccess	Hybrid-testVm01/enablevmAccess	Microsoft.Compute/virtualMachines/extensions	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.297311	2026-06-29 19:15:22.297311
521	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.CognitiveServices/accounts/ai-sccc	ai-sccc	Microsoft.CognitiveServices/accounts	Hybr0d-Network	eastus2	AIServices	S0	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.299742	2026-06-29 19:15:22.299742
522	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.CognitiveServices/accounts/ai-sccc/projects/ai-sccc	ai-sccc/ai-sccc	Microsoft.CognitiveServices/accounts/projects	Hybr0d-Network	eastus2	AIServices	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.302157	2026-06-29 19:15:22.302157
523	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/networkInterfaces/gateway2	gateway2	Microsoft.Network/networkInterfaces	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.304576	2026-06-29 19:15:22.304576
524	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/dataCollectionRules/MSVMI-centralus-ciscodirectoryconnector	MSVMI-centralus-ciscodirectoryconnector	Microsoft.Insights/dataCollectionRules	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.307117	2026-06-29 19:15:22.307117
525	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Insights/dataCollectionRules/MSVMOtel-centralus-ciscodirectoryconnector	MSVMOtel-centralus-ciscodirectoryconnector	Microsoft.Insights/dataCollectionRules	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.309507	2026-06-29 19:15:22.309507
526	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/microsoft.compute/virtualMachines/ciscodirectoryconnector/extensions/AzureMonitorLinuxAgent	ciscodirectoryconnector/AzureMonitorLinuxAgent	microsoft.compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.314137	2026-06-29 19:15:22.314137
527	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/keystone/extensions/SqlIaasExtension	keystone/SqlIaasExtension	Microsoft.Compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.316599	2026-06-29 19:15:22.316599
528	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.SqlVirtualMachine/SqlVirtualMachines/keystone	keystone	Microsoft.SqlVirtualMachine/SqlVirtualMachines	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.31939	2026-06-29 19:15:22.31939
529	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Compute/virtualMachines/goverlan/extensions/SqlIaasExtension	goverlan/SqlIaasExtension	Microsoft.Compute/virtualMachines/extensions	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.322155	2026-06-29 19:15:22.322155
530	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.SqlVirtualMachine/SqlVirtualMachines/goverlan	goverlan	Microsoft.SqlVirtualMachine/SqlVirtualMachines	hybr0d-network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.324738	2026-06-29 19:15:22.324738
531	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-04-27T05-30-51.8929693	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-04-27T05-30-51.8929693	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.327342	2026-06-29 19:15:22.327342
532	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-04-27T05-30-51.8773561	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-04-27T05-30-51.8773561	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.329898	2026-06-29 19:15:22.329898
533	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-04-27T05-30-55.9928185	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-04-27T05-30-55.9928185	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.332648	2026-06-29 19:15:22.332648
534	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-04-27T05-30-58.2608562	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-04-27T05-30-58.2608562	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.3351	2026-06-29 19:15:22.3351
535	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-04-27T05-31-10.1254687	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-04-27T05-31-10.1254687	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.340582	2026-06-29 19:15:22.340582
536	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-04T05-30-44.2413534	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-04T05-30-44.2413534	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.344679	2026-06-29 19:15:22.344679
537	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-04T05-30-45.8824498	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-04T05-30-45.8824498	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.349048	2026-06-29 19:15:22.349048
538	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-04T05-30-55.8881373	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-04T05-30-55.8881373	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.35196	2026-06-29 19:15:22.35196
539	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-04T05-30-56.5038492	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-04T05-30-56.5038492	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.3547	2026-06-29 19:15:22.3547
540	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-04T05-30-59.9596042	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-04T05-30-59.9596042	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.357226	2026-06-29 19:15:22.357226
541	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Network/networkSecurityGroups/canva-Backup-nsg	canva-Backup-nsg	Microsoft.Network/networkSecurityGroups	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.36497	2026-06-29 19:15:22.36497
542	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Network/networkInterfaces/canva-backup164_z1	canva-backup164_z1	Microsoft.Network/networkInterfaces	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.367739	2026-06-29 19:15:22.367739
543	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Compute/virtualMachines/canva-Backup	canva-Backup	Microsoft.Compute/virtualMachines	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.370546	2026-06-29 19:15:22.370546
544	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/TEST/providers/Microsoft.Compute/disks/canva-Backup_OsDisk_1_336b0e74badd4969ab5d2d90ca1f3e21	canva-Backup_OsDisk_1_336b0e74badd4969ab5d2d90ca1f3e21	Microsoft.Compute/disks	TEST	centralus	\N	Premium_LRS	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.373177	2026-06-29 19:15:22.373177
545	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/OS Disk IOPS Consumed Percentage - canva-Backup	OS Disk IOPS Consumed Percentage - canva-Backup	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.37589	2026-06-29 19:15:22.37589
546	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Network In Total - canva-Backup	Network In Total - canva-Backup	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.378731	2026-06-29 19:15:22.378731
547	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Percentage CPU - canva-Backup	Percentage CPU - canva-Backup	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.381333	2026-06-29 19:15:22.381333
548	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Data Disk IOPS Consumed Percentage - canva-Backup	Data Disk IOPS Consumed Percentage - canva-Backup	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.383965	2026-06-29 19:15:22.383965
549	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Network Out Total - canva-Backup	Network Out Total - canva-Backup	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.387122	2026-06-29 19:15:22.387122
550	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/Available Memory Bytes - canva-Backup	Available Memory Bytes - canva-Backup	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.392982	2026-06-29 19:15:22.392982
551	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/metricalerts/VM Availability - canva-Backup	VM Availability - canva-Backup	Microsoft.Insights/metricalerts	test	global	\N	\N	{"alertRuleCreatedWithAlertsRecommendations":"true"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.39577	2026-06-29 19:15:22.39577
552	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-ad_sc03-ad_sc03_-d8087454-d157-4733-9f1d-2cb17a8fa221	asrseeddisk-ad_sc03-ad_sc03_-d8087454-d157-4733-9f1d-2cb17a8fa221	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	StandardSSD_LRS	{"asrseeddisk-4b8c035f-08ce-4c09-919c-3b4ad8aa5ad7":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.398547	2026-06-29 19:15:22.398547
553	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-New_DHCP-New_DHCP-54fbbe2c-88bb-4eda-94bd-05404542c24a	asrseeddisk-New_DHCP-New_DHCP-54fbbe2c-88bb-4eda-94bd-05404542c24a	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	StandardSSD_LRS	{"asrseeddisk-f6a1f467-d85e-43f4-965c-a9e59cae1cde":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.401432	2026-06-29 19:15:22.401432
554	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-New_DNS_-New_DNS_-e1f15c4c-0c3c-43a6-a822-be43fe720110	asrseeddisk-New_DNS_-New_DNS_-e1f15c4c-0c3c-43a6-a822-be43fe720110	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	StandardSSD_LRS	{"asrseeddisk-fb8b0840-85e7-406e-a264-2093d8d46e68":"This resource is in use by Azure Site Recovery Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.404883	2026-06-29 19:15:22.404883
555	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-11T05-30-44.8032057	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-11T05-30-44.8032057	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.407717	2026-06-29 19:15:22.407717
556	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-11T05-30-48.5617587	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-11T05-30-48.5617587	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.411083	2026-06-29 19:15:22.411083
557	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-11T05-30-49.4088554	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-11T05-30-49.4088554	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.413618	2026-06-29 19:15:22.413618
558	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-11T05-30-50.1336006	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-11T05-30-50.1336006	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.416067	2026-06-29 19:15:22.416067
559	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-11T05-30-52.0988676	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-11T05-30-52.0988676	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.418472	2026-06-29 19:15:22.418472
560	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/dataCollectionRules/MSVMOtel-centralus-canva-backup	MSVMOtel-centralus-canva-backup	Microsoft.Insights/dataCollectionRules	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.420971	2026-06-29 19:15:22.420971
561	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Insights/dataCollectionRules/MSVMI-centralus-canva-backup	MSVMI-centralus-canva-backup	Microsoft.Insights/dataCollectionRules	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.423797	2026-06-29 19:15:22.423797
562	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/microsoft.compute/virtualMachines/canva-backup/extensions/AzureMonitorWindowsAgent	canva-backup/AzureMonitorWindowsAgent	microsoft.compute/virtualMachines/extensions	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.426989	2026-06-29 19:15:22.426989
563	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/defaultresourcegroup-cus/providers/Microsoft.OperationsManagement/solutions/ChangeTracking(DefaultWorkspace-1d602111-1398-40e7-9555-baf6a406975d-CUS)	ChangeTracking(DefaultWorkspace-1d602111-1398-40e7-9555-baf6a406975d-CUS)	Microsoft.OperationsManagement/solutions	defaultresourcegroup-cus	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.430768	2026-06-29 19:15:22.430768
564	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/defaultresourcegroup-cus/providers/Microsoft.Insights/dataCollectionRules/ct-dcr736914992-07371186	ct-dcr736914992-07371186	Microsoft.Insights/dataCollectionRules	defaultresourcegroup-cus	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.433454	2026-06-29 19:15:22.433454
565	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Compute/virtualMachines/canva-backup/extensions/ChangeTracking-Windows	canva-backup/ChangeTracking-Windows	Microsoft.Compute/virtualMachines/extensions	test	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.43621	2026-06-29 19:15:22.43621
566	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/defaultresourcegroup-cus/providers/Microsoft.Insights/dataCollectionRules/ct-dcr736914992-07527225	ct-dcr736914992-07527225	Microsoft.Insights/dataCollectionRules	defaultresourcegroup-cus	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.438834	2026-06-29 19:15:22.438834
567	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/virtualMachines/ad-sc01/extensions/ChangeTracking-Windows	ad-sc01/ChangeTracking-Windows	Microsoft.Compute/virtualMachines/extensions	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.441362	2026-06-29 19:15:22.441362
568	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/test/providers/Microsoft.Network/publicIPAddresses/PublicIP_New	PublicIP_New	Microsoft.Network/publicIPAddresses	test	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.443996	2026-06-29 19:15:22.443996
569	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-18T05-30-48.4071339	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-18T05-30-48.4071339	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.446467	2026-06-29 19:15:22.446467
570	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-18T05-30-50.3133969	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-18T05-30-50.3133969	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.449108	2026-06-29 19:15:22.449108
571	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-18T05-30-51.9774337	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-18T05-30-51.9774337	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.452195	2026-06-29 19:15:22.452195
572	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-18T05-30-59.8989242	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-18T05-30-59.8989242	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.454717	2026-06-29 19:15:22.454717
573	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-18T05-30-59.9457983	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-18T05-30-59.9457983	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.457326	2026-06-29 19:15:22.457326
574	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-25T05-30-51.7948817	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-25T05-30-51.7948817	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.46059	2026-06-29 19:15:22.46059
575	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-25T05-30-52.2105861	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-25T05-30-52.2105861	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.463788	2026-06-29 19:15:22.463788
576	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-25T05-30-59.6139387	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-25T05-30-59.6139387	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.466405	2026-06-29 19:15:22.466405
577	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-25T05-30-59.6295639	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-25T05-30-59.6295639	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.469796	2026-06-29 19:15:22.469796
578	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-25T05-31-06.2994111	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-25T05-31-06.2994111	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.472184	2026-06-29 19:15:22.472184
579	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-31T05-30-46.5889861	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-05-31T05-30-46.5889861	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.474754	2026-06-29 19:15:22.474754
580	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-31T05-30-50.8285813	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-05-31T05-30-50.8285813	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.477429	2026-06-29 19:15:22.477429
581	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-31T05-30-54.7676616	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-05-31T05-30-54.7676616	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.480428	2026-06-29 19:15:22.480428
582	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-31T05-30-56.1227632	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-05-31T05-30-56.1227632	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.482855	2026-06-29 19:15:22.482855
583	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-31T05-30-58.0651298	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-05-31T05-30-58.0651298	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.485387	2026-06-29 19:15:22.485387
584	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-01T05-30-49.9219544	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-01T05-30-49.9219544	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.487618	2026-06-29 19:15:22.487618
585	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-01T05-30-52.3706735	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-01T05-30-52.3706735	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.490136	2026-06-29 19:15:22.490136
586	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-01T05-30-52.8895485	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-01T05-30-52.8895485	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.492642	2026-06-29 19:15:22.492642
587	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-01T05-30-58.1675425	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-01T05-30-58.1675425	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.495419	2026-06-29 19:15:22.495419
588	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-01T05-30-59.1107272	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-01T05-30-59.1107272	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.497863	2026-06-29 19:15:22.497863
589	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-02T05-30-45.4580759	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-02T05-30-45.4580759	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.500335	2026-06-29 19:15:22.500335
590	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-02T05-30-47.8151614	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-02T05-30-47.8151614	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.502923	2026-06-29 19:15:22.502923
591	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-02T05-30-50.4896196	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-02T05-30-50.4896196	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.5066	2026-06-29 19:15:22.5066
592	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-02T05-30-54.1963190	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-02T05-30-54.1963190	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.509143	2026-06-29 19:15:22.509143
593	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-02T05-30-57.4290996	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-02T05-30-57.4290996	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.511555	2026-06-29 19:15:22.511555
594	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-03T05-30-44.9389259	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-03T05-30-44.9389259	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.514162	2026-06-29 19:15:22.514162
595	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-03T05-30-54.8005764	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-03T05-30-54.8005764	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.517159	2026-06-29 19:15:22.517159
596	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-03T05-30-55.0804747	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-03T05-30-55.0804747	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.519584	2026-06-29 19:15:22.519584
597	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-03T05-30-57.1920276	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-03T05-30-57.1920276	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.522133	2026-06-29 19:15:22.522133
598	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-03T05-30-58.8890716	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-03T05-30-58.8890716	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.527649	2026-06-29 19:15:22.527649
599	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-04T05-31-01.4577989	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-04T05-31-01.4577989	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.53072	2026-06-29 19:15:22.53072
600	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-04T05-31-02.1099151	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-04T05-31-02.1099151	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.533284	2026-06-29 19:15:22.533284
601	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-04T05-31-09.4525863	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-04T05-31-09.4525863	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.53604	2026-06-29 19:15:22.53604
602	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-04T05-31-17.2541058	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-04T05-31-17.2541058	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.539161	2026-06-29 19:15:22.539161
603	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-04T05-31-00.2930565	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-04T05-31-00.2930565	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.542059	2026-06-29 19:15:22.542059
604	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-05T05-30-47.3075514	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-05T05-30-47.3075514	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.545297	2026-06-29 19:15:22.545297
605	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-05T05-30-47.8787659	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-05T05-30-47.8787659	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.548477	2026-06-29 19:15:22.548477
606	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-05T05-30-54.2435363	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-05T05-30-54.2435363	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.550992	2026-06-29 19:15:22.550992
607	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-05T05-31-00.4972962	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-05T05-31-00.4972962	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.554177	2026-06-29 19:15:22.554177
608	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-05T05-31-01.2424945	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-05T05-31-01.2424945	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.562308	2026-06-29 19:15:22.562308
609	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-06T05-30-49.7636884	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-06T05-30-49.7636884	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.565602	2026-06-29 19:15:22.565602
610	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-06T05-30-54.6378467	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-06T05-30-54.6378467	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.568752	2026-06-29 19:15:22.568752
611	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-06T05-30-59.8911349	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-06T05-30-59.8911349	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.572034	2026-06-29 19:15:22.572034
612	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-06T05-31-00.1218789	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-06T05-31-00.1218789	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.574668	2026-06-29 19:15:22.574668
613	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-06T05-31-01.4182433	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-06T05-31-01.4182433	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.577637	2026-06-29 19:15:22.577637
614	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-07T05-30-46.0163296	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-07T05-30-46.0163296	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.580221	2026-06-29 19:15:22.580221
615	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-07T05-30-55.3347332	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-07T05-30-55.3347332	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.583063	2026-06-29 19:15:22.583063
616	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-07T05-30-58.0016814	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-07T05-30-58.0016814	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.585693	2026-06-29 19:15:22.585693
617	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-07T05-31-03.3426765	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-07T05-31-03.3426765	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.588339	2026-06-29 19:15:22.588339
618	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-07T05-31-05.4681092	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-07T05-31-05.4681092	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.591134	2026-06-29 19:15:22.591134
619	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-08T05-30-52.1272860	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-08T05-30-52.1272860	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.594259	2026-06-29 19:15:22.594259
620	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-08T05-30-52.5417651	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-08T05-30-52.5417651	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.596924	2026-06-29 19:15:22.596924
621	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-08T05-30-55.8080784	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-08T05-30-55.8080784	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.599433	2026-06-29 19:15:22.599433
622	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-08T05-31-01.8841469	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-08T05-31-01.8841469	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.601883	2026-06-29 19:15:22.601883
623	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-08T05-31-03.5663573	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-08T05-31-03.5663573	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.604695	2026-06-29 19:15:22.604695
624	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-09T05-30-49.8105208	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-09T05-30-49.8105208	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.608915	2026-06-29 19:15:22.608915
625	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-09T05-30-51.9812987	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-09T05-30-51.9812987	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.611343	2026-06-29 19:15:22.611343
626	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-09T05-30-51.8562976	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-09T05-30-51.8562976	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.613886	2026-06-29 19:15:22.613886
627	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-09T05-31-01.3907109	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-09T05-31-01.3907109	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.616481	2026-06-29 19:15:22.616481
628	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-09T05-31-06.0281714	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-09T05-31-06.0281714	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.620376	2026-06-29 19:15:22.620376
629	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-10T05-30-46.5217289	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-10T05-30-46.5217289	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.623255	2026-06-29 19:15:22.623255
630	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-10T05-30-47.7879128	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-10T05-30-47.7879128	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.629063	2026-06-29 19:15:22.629063
631	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-10T05-30-54.6068709	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-10T05-30-54.6068709	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.631554	2026-06-29 19:15:22.631554
632	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-10T05-30-59.6497638	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-10T05-30-59.6497638	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.633733	2026-06-29 19:15:22.633733
633	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-10T05-30-48.5462126	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-10T05-30-48.5462126	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.636868	2026-06-29 19:15:22.636868
634	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-11T05-30-44.9823915	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-11T05-30-44.9823915	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.639729	2026-06-29 19:15:22.639729
635	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-11T05-30-45.0761435	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-11T05-30-45.0761435	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.642199	2026-06-29 19:15:22.642199
636	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-11T05-30-48.4859511	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-11T05-30-48.4859511	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.644442	2026-06-29 19:15:22.644442
637	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-11T05-30-45.0761435	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-11T05-30-45.0761435	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.647594	2026-06-29 19:15:22.647594
638	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-11T05-30-49.5209515	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-11T05-30-49.5209515	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.64994	2026-06-29 19:15:22.64994
639	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-12T05-30-51.1237572	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-12T05-30-51.1237572	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.653091	2026-06-29 19:15:22.653091
640	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-12T05-30-52.1082076	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-12T05-30-52.1082076	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.655575	2026-06-29 19:15:22.655575
641	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-12T05-30-52.2957233	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-12T05-30-52.2957233	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.658048	2026-06-29 19:15:22.658048
642	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-12T05-30-53.1286511	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-12T05-30-53.1286511	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.660645	2026-06-29 19:15:22.660645
643	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-12T05-31-05.5295197	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-12T05-31-05.5295197	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.663557	2026-06-29 19:15:22.663557
644	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-13T05-30-50.9636787	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-13T05-30-50.9636787	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.66603	2026-06-29 19:15:22.66603
645	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-13T05-30-55.4025151	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-13T05-30-55.4025151	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.673145	2026-06-29 19:15:22.673145
646	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-13T05-31-01.1328726	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-13T05-31-01.1328726	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.676947	2026-06-29 19:15:22.676947
647	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-13T05-30-58.1417779	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-13T05-30-58.1417779	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.680165	2026-06-29 19:15:22.680165
648	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-13T05-31-14.2594699	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-13T05-31-14.2594699	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.682717	2026-06-29 19:15:22.682717
649	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/VMAssessment/providers/Microsoft.ApplicationMigration/mongoSites/VMAssessmentmongo	VMAssessmentmongo	Microsoft.ApplicationMigration/mongoSites	VMAssessment	westus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.685426	2026-06-29 19:15:22.685426
650	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-AD_SC02-AD_SC02-9b78ed15-a40a-4656-aebb-382705ddced8	asrseeddisk-AD_SC02-AD_SC02-9b78ed15-a40a-4656-aebb-382705ddced8	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-b631b239-8896-5885-ab01-2b87eeae74cb":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.687775	2026-06-29 19:15:22.687775
651	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/disks/asrseeddisk-AD_SC00-AD_SC00-5efbb49e-4445-4d44-a6c8-c7752252aa6e	asrseeddisk-AD_SC00-AD_SC00-5efbb49e-4445-4d44-a6c8-c7752252aa6e	Microsoft.Compute/disks	Hybr0d-Network	centralus	\N	Standard_LRS	{"asrseeddisk-43954b3a-b7b2-536c-900d-4dd311e6d104":"This resource is in use by Server Migration Service."}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.690398	2026-06-29 19:15:22.690398
652	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-14T05-30-48.4375780	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-14T05-30-48.4375780	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.692867	2026-06-29 19:15:22.692867
653	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-14T05-30-48.5782419	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-14T05-30-48.5782419	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.695455	2026-06-29 19:15:22.695455
654	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-14T05-30-50.4413321	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-14T05-30-50.4413321	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.698286	2026-06-29 19:15:22.698286
655	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-14T05-30-58.8369160	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-14T05-30-58.8369160	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.701137	2026-06-29 19:15:22.701137
656	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-14T05-31-01.2515605	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-14T05-31-01.2515605	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.703776	2026-06-29 19:15:22.703776
657	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-15T05-30-46.5174714	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-15T05-30-46.5174714	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.706722	2026-06-29 19:15:22.706722
658	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-15T05-30-47.0868045	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-15T05-30-47.0868045	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.709521	2026-06-29 19:15:22.709521
659	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-15T05-30-47.5331527	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-15T05-30-47.5331527	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.712452	2026-06-29 19:15:22.712452
660	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-15T05-30-49.5272859	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-15T05-30-49.5272859	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.715018	2026-06-29 19:15:22.715018
661	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-15T05-31-01.0038456	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-15T05-31-01.0038456	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.718051	2026-06-29 19:15:22.718051
662	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-16T05-30-47.6874742	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-16T05-30-47.6874742	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.720237	2026-06-29 19:15:22.720237
663	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-16T05-30-48.3019111	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-16T05-30-48.3019111	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.722745	2026-06-29 19:15:22.722745
664	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-16T05-30-49.8127884	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-16T05-30-49.8127884	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.725144	2026-06-29 19:15:22.725144
665	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-16T05-30-58.9381491	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-16T05-30-58.9381491	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.730105	2026-06-29 19:15:22.730105
666	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-16T05-33-19.1846026	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-16T05-33-19.1846026	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.73286	2026-06-29 19:15:22.73286
667	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-17T05-30-50.2983609	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-17T05-30-50.2983609	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.73562	2026-06-29 19:15:22.73562
668	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-17T05-30-50.2289730	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-17T05-30-50.2289730	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.73895	2026-06-29 19:15:22.73895
669	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-17T05-30-51.2959280	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-17T05-30-51.2959280	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.741829	2026-06-29 19:15:22.741829
670	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-17T05-31-02.0283409	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-17T05-31-02.0283409	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.745875	2026-06-29 19:15:22.745875
671	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-17T05-31-16.1488295	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-17T05-31-16.1488295	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.748789	2026-06-29 19:15:22.748789
672	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-18T05-30-44.4891427	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-18T05-30-44.4891427	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.751731	2026-06-29 19:15:22.751731
673	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-18T05-30-45.9340210	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-18T05-30-45.9340210	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.75442	2026-06-29 19:15:22.75442
674	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-18T05-30-48.2437271	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-18T05-30-48.2437271	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.757004	2026-06-29 19:15:22.757004
675	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-18T05-30-56.9292322	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-18T05-30-56.9292322	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.759967	2026-06-29 19:15:22.759967
676	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-18T05-30-57.9387593	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-18T05-30-57.9387593	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.762377	2026-06-29 19:15:22.762377
677	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Network/publicIPAddresses/SCCC_Fortinet_VPN	SCCC_Fortinet_VPN	Microsoft.Network/publicIPAddresses	Hybr0d-Network	centralus	\N	Standard	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.765015	2026-06-29 19:15:22.765015
678	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.Compute/virtualMachines/PROD-IIS-WEB01/extensions/AdminCenter	PROD-IIS-WEB01/AdminCenter	Microsoft.Compute/virtualMachines/extensions	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.76728	2026-06-29 19:15:22.76728
679	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-19T05-30-47.3547396	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-19T05-30-47.3547396	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.769669	2026-06-29 19:15:22.769669
680	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-19T05-30-49.4422608	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-19T05-30-49.4422608	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.772999	2026-06-29 19:15:22.772999
681	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-19T05-30-56.9011669	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-19T05-30-56.9011669	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.776119	2026-06-29 19:15:22.776119
682	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-19T05-30-57.9628058	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-19T05-30-57.9628058	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.778627	2026-06-29 19:15:22.778627
683	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-19T05-30-58.7606484	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-19T05-30-58.7606484	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.781017	2026-06-29 19:15:22.781017
684	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-20T05-30-47.2164809	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-20T05-30-47.2164809	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.784618	2026-06-29 19:15:22.784618
685	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-20T05-30-47.3727332	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-20T05-30-47.3727332	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.787381	2026-06-29 19:15:22.787381
686	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-20T05-30-56.3227725	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-20T05-30-56.3227725	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.789837	2026-06-29 19:15:22.789837
687	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-20T05-31-02.4560391	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-20T05-31-02.4560391	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.792377	2026-06-29 19:15:22.792377
688	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-20T05-31-05.5271579	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-20T05-31-05.5271579	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.794996	2026-06-29 19:15:22.794996
689	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-21T05-30-44.5698070	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-21T05-30-44.5698070	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.798191	2026-06-29 19:15:22.798191
690	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-21T05-30-55.5435467	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-21T05-30-55.5435467	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.800551	2026-06-29 19:15:22.800551
691	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-21T05-30-56.5835556	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-21T05-30-56.5835556	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.80871	2026-06-29 19:15:22.80871
692	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-21T05-30-57.7266587	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-21T05-30-57.7266587	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.811046	2026-06-29 19:15:22.811046
693	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-21T05-30-59.1477538	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-21T05-30-59.1477538	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.813769	2026-06-29 19:15:22.813769
694	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.DevTestLab/schedules/shutdown-computevm-COMPRESSORPT2	shutdown-computevm-COMPRESSORPT2	Microsoft.DevTestLab/schedules	Hybr0d-Network	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.816146	2026-06-29 19:15:22.816146
695	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Web/connections/azurevm	azurevm	Microsoft.Web/connections	hybr0d-network	centralus	V1	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.818754	2026-06-29 19:15:22.818754
696	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Web/connections/office365	office365	Microsoft.Web/connections	hybr0d-network	centralus	V1	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.821104	2026-06-29 19:15:22.821104
697	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Logic/workflows/AutoShutdown	AutoShutdown	Microsoft.Logic/workflows	hybr0d-network	centralus	AutomationTask	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.824318	2026-06-29 19:15:22.824318
698	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/hybr0d-network/providers/Microsoft.Logic/workflows/AutoStart	AutoStart	Microsoft.Logic/workflows	hybr0d-network	centralus	AutomationTask	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.827017	2026-06-29 19:15:22.827017
699	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-22T05-30-43.4949938	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-22T05-30-43.4949938	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.829514	2026-06-29 19:15:22.829514
700	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-22T05-30-43.2287092	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-22T05-30-43.2287092	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.833031	2026-06-29 19:15:22.833031
701	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-22T05-30-46.6554588	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-22T05-30-46.6554588	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.835705	2026-06-29 19:15:22.835705
702	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-22T05-30-56.0596466	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-22T05-30-56.0596466	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.838229	2026-06-29 19:15:22.838229
703	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-22T05-30-57.3327873	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-22T05-30-57.3327873	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.841316	2026-06-29 19:15:22.841316
704	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/MFS0/extensions/enablevmAccess	MFS0/enablevmAccess	Microsoft.Compute/virtualMachines/extensions	HYBR0D-NETWORK	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.843867	2026-06-29 19:15:22.843867
705	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-23T05-30-48.7851676	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-23T05-30-48.7851676	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.84657	2026-06-29 19:15:22.84657
706	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-23T05-30-48.6640761	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-23T05-30-48.6640761	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.849084	2026-06-29 19:15:22.849084
707	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-23T05-30-49.9090261	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-23T05-30-49.9090261	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.854596	2026-06-29 19:15:22.854596
708	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-23T05-30-56.6489980	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-23T05-30-56.6489980	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.85761	2026-06-29 19:15:22.85761
709	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-23T05-31-01.0172638	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-23T05-31-01.0172638	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.859972	2026-06-29 19:15:22.859972
710	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-24T05-30-46.8499969	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-24T05-30-46.8499969	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.862657	2026-06-29 19:15:22.862657
711	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-24T05-30-52.9469108	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-24T05-30-52.9469108	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.865031	2026-06-29 19:15:22.865031
712	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-24T05-30-49.1472308	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-24T05-30-49.1472308	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.867798	2026-06-29 19:15:22.867798
713	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-24T05-30-57.9782055	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-24T05-30-57.9782055	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.870305	2026-06-29 19:15:22.870305
714	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-24T05-31-02.3270044	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-24T05-31-02.3270044	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.872796	2026-06-29 19:15:22.872796
715	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-25T05-30-44.6753312	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-25T05-30-44.6753312	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.875172	2026-06-29 19:15:22.875172
716	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-25T05-30-51.7175065	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-25T05-30-51.7175065	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.877751	2026-06-29 19:15:22.877751
717	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-25T05-30-59.0383533	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-25T05-30-59.0383533	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.88067	2026-06-29 19:15:22.88067
718	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-25T05-31-00.9357854	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-25T05-31-00.9357854	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.883133	2026-06-29 19:15:22.883133
719	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-25T05-31-01.9561173	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-25T05-31-01.9561173	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.885361	2026-06-29 19:15:22.885361
720	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-26T05-30-54.6703370	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-26T05-30-54.6703370	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.887813	2026-06-29 19:15:22.887813
721	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-26T05-30-57.4497002	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-26T05-30-57.4497002	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.890029	2026-06-29 19:15:22.890029
722	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-26T05-31-02.7358270	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-26T05-31-02.7358270	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.89227	2026-06-29 19:15:22.89227
723	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-26T05-31-02.7670625	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-26T05-31-02.7670625	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.896047	2026-06-29 19:15:22.896047
724	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-26T05-31-12.6223006	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-26T05-31-12.6223006	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.89851	2026-06-29 19:15:22.89851
725	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-27T05-30-51.6778470	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-27T05-30-51.6778470	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.901001	2026-06-29 19:15:22.901001
726	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-27T05-31-00.8594231	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-27T05-31-00.8594231	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.903899	2026-06-29 19:15:22.903899
727	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-27T05-31-04.3367103	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-27T05-31-04.3367103	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.906236	2026-06-29 19:15:22.906236
728	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-27T05-31-11.5071571	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-27T05-31-11.5071571	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.908823	2026-06-29 19:15:22.908823
729	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-27T05-31-07.0224370	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-27T05-31-07.0224370	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.911936	2026-06-29 19:15:22.911936
730	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-28T05-30-48.1043409	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-28T05-30-48.1043409	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.914673	2026-06-29 19:15:22.914673
731	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-28T05-30-49.1149064	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-28T05-30-49.1149064	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.91766	2026-06-29 19:15:22.91766
732	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-28T05-30-53.3140944	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-28T05-30-53.3140944	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.920372	2026-06-29 19:15:22.920372
733	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-28T05-30-53.2191294	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-28T05-30-53.2191294	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.922968	2026-06-29 19:15:22.922968
734	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/ResourceMoverRG-centralus-eastus-eus2/providers/Microsoft.Migrate/moveCollections/MoveCollection-cus-eus-eus2	MoveCollection-cus-eus-eus2	Microsoft.Migrate/moveCollections	ResourceMoverRG-centralus-eastus-eus2	eastus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.925602	2026-06-29 19:15:22.925602
735	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/ResourceMoverRG-eastus2-centralus-eus2/providers/Microsoft.Migrate/moveCollections/MoveCollection-eus2-cus-eus2	MoveCollection-eus2-cus-eus2	Microsoft.Migrate/moveCollections	ResourceMoverRG-eastus2-centralus-eus2	eastus2	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.927992	2026-06-29 19:15:22.927992
736	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/DefaultResourceGroup-EUS/providers/Microsoft.OperationalInsights/workspaces/DefaultWorkspace-1d602111-1398-40e7-9555-baf6a406975d-EUS	DefaultWorkspace-1d602111-1398-40e7-9555-baf6a406975d-EUS	Microsoft.OperationalInsights/workspaces	DefaultResourceGroup-EUS	eastus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.930634	2026-06-29 19:15:22.930634
737	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/DefaultResourceGroup-EUS/providers/Microsoft.Insights/dataCollectionRules/MSVMI-DefaultWorkspace-1d602111-1398-40e7-9555-baf6a406975d-EUS	MSVMI-DefaultWorkspace-1d602111-1398-40e7-9555-baf6a406975d-EUS	Microsoft.Insights/dataCollectionRules	DefaultResourceGroup-EUS	eastus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.932963	2026-06-29 19:15:22.932963
738	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-28T05-30-58.6435767	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-28T05-30-58.6435767	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.93557	2026-06-29 19:15:22.93557
739	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-29T05-30-52.8780766	AzureBackup_14a87769-6e87-4b3a-906b-d662bf74aeb5_2026-06-29T05-30-52.8780766	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.938304	2026-06-29 19:15:22.938304
740	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-29T05-30-51.2944522	AzureBackup_5a59942b-6a8e-4295-9e78-1c7ff0ac9083_2026-06-29T05-30-51.2944522	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.940989	2026-06-29 19:15:22.940989
741	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-29T05-30-57.5031164	AzureBackup_9358fee8-994d-4ea3-a1e9-b3a713b3de2d_2026-06-29T05-30-57.5031164	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.943291	2026-06-29 19:15:22.943291
742	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-29T05-31-02.9890814	AzureBackup_c1c85a16-862e-4d7a-946e-d90987970b6a_2026-06-29T05-31-02.9890814	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.946006	2026-06-29 19:15:22.946006
743	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/Hybr0d-Network/providers/Microsoft.Compute/snapshots/AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-29T05-31-07.8750480	AzureBackup_40553a51-37ad-4996-9426-282660feaee5_2026-06-29T05-31-07.8750480	Microsoft.Compute/snapshots	Hybr0d-Network	centralus	\N	Standard_ZRS	{"AzHydration-ManagedDisk-CreatedBy":"Azure Migrate","CreatedBy":"AzureBackup"}	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.948618	2026-06-29 19:15:22.948618
744	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-Prod-CentralUS/providers/Microsoft.KeyVault/vaults/SewardIT	SewardIT	Microsoft.KeyVault/vaults	RG-Prod-CentralUS	centralus	\N	\N	\N	1d602111-1398-40e7-9555-baf6a406975d	active	azure	\N	2026-06-29 19:15:20.533	12	2026-06-29 19:15:22.951062	2026-06-29 19:15:22.951062
\.


--
-- Data for Name: azure_vms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.azure_vms (id, name, resource_group, subscription, location, size, os, private_ip, public_ip, vnet, subnet, status, purpose, notes, owner, created_by, created_at, updated_at, azure_resource_id, source, last_synced_at) FROM stdin;
11	ONERING16	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2a_v4	Windows	10.0.0.23	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.828237	\N	manual	\N
17	AD-SC01	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2a_v4	Windows	10.0.0.34	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.762353	\N	manual	\N
10	CiscoDirectoryConnector	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_DS1_v2	Linux	10.0.0.22	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.795496	\N	manual	\N
29	COMPRESSORPT2	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	Windows	10.0.0.18	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.79879	\N	manual	\N
18	EntraCloudConnect	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_F2s_v2	Windows	10.0.0.15	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.801877	\N	manual	\N
9	Goverlan	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_DS11-1_v2	Windows	10.0.0.16	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.80506	\N	manual	\N
4	GSYNC0	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	Windows	10.0.0.21	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.807775	\N	manual	\N
21	KEYSTONE	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	Windows	10.0.0.20	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.81092	\N	manual	\N
8	lucas-flare	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D4as_v5	Windows	10.0.0.28	4.150.203.199	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.814292	\N	manual	\N
36	LUCAS-KALI	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_DS3_v2	Linux	10.0.0.10, 10.0.0.11, 10.0.0.12	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.81752	\N	manual	\N
14	MFS0	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2ds_v4	Windows	10.0.0.32, 10.0.0.33	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.820629	\N	manual	\N
31	netedit	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A1_v2	Linux	10.0.0.14	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.82344	\N	manual	\N
33	New-TrendMicroA	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	Linux	10.0.0.38	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.82557	\N	manual	\N
5	PRNTSP2	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2ds_v4	Windows	10.0.0.30	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.831121	\N	manual	\N
6	PTEC2	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2_v4	Windows	10.0.0.24	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.833273	\N	manual	\N
19	SalonIRIS	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2ds_v4	Windows	10.0.0.36	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.835807	\N	manual	\N
26	SCCCMFS01	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	Windows	10.0.0.8	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.838503	\N	manual	\N
20	SteamPT-License-Server	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2as_v5	Windows	10.0.0.13	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.841173	\N	manual	\N
3	Syslog-Forwarder	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A2_v2	Linux	10.0.0.37	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.843969	\N	manual	\N
23	TRACDAT2	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A2_v2	Windows	10.0.0.25	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.846649	\N	manual	\N
35	TRENDV1SVCGW	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	Linux	10.0.0.19	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.849489	\N	manual	\N
37	WAC	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	Windows	10.0.0.35	20.80.72.179	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.852008	\N	manual	\N
24	WDS-New	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2as_v5	Windows	10.0.0.7	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.854419	\N	manual	\N
7	WEB	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A2_v2	Windows	10.0.0.26	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.857339	\N	manual	\N
15	WEB-LIVE2	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2as_v5	Windows	10.0.0.27, 10.0.0.29	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.860529	\N	manual	\N
25	WSUS	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_DS11-1_v2	Windows	10.0.0.17	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.863793	\N	manual	\N
34	XMAIL16-New	hybr0d-network	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D4as_v4	Windows	10.0.0.31	\N	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.866613	\N	manual	\N
22	Hybrid-testVm01	rg-prod-centralus	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_DS1_v2	Windows	10.0.0.9	172.202.115.228	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.869401	\N	manual	\N
32	KMS	rg-prod-centralus	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A1_v2	Windows	10.0.0.4	132.196.97.226	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.872169	\N	manual	\N
12	OITJUMP02	rg-prod-centralus	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D4s_v4	Windows	10.40.1.248, 10.40.1.4	\N	\N	\N	stopped	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.874771	\N	manual	\N
27	PROD-IIS-WEB01	rg-prod-centralus	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v5	Windows	10.110.1.4	130.131.156.14	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.876756	\N	manual	\N
28	Test-1	rg-prod-centralus	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_DS1_v2	Windows	10.0.0.6	\N	\N	\N	stopped	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.879496	\N	manual	\N
30	AzADC001	sccc_domain_services	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	Windows	10.0.0.6	40.67.170.222	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.882464	\N	manual	\N
13	IIS-VM	sccc_domain_services	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	Windows	10.0.0.8	52.173.23.138	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.885218	\N	manual	\N
16	test-gateway	test	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	Linux	10.2.0.4	128.203.233.52	\N	\N	running	\N	\N	\N	\N	2026-04-24 04:24:01.48466	2026-04-24 04:39:27.887357	\N	manual	\N
38	AD-SC01	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2a_v4	Windows	10.0.0.34	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.818351	2026-06-29 18:34:20.818351	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/AD-SC01	azure	2026-06-29 18:34:20.81
39	Barracuda-Replacement	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2as_v4	windowsserver2022 2022-datacenter-g2	10.0.0.41	\N	Hybrid-VNet	Hybrid_default	deallocated	\N	\N	\N	1	2026-06-29 18:34:20.864234	2026-06-29 18:34:20.864234	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/Barracuda-Replacement	azure	2026-06-29 18:34:20.81
40	CiscoDirectoryConnector	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D8as_v5	ubuntu-24_04-lts server	10.0.0.22	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.868239	2026-06-29 18:34:20.868239	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/CiscoDirectoryConnector	azure	2026-06-29 18:34:20.81
41	COMPRESSORPT2	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	Windows	10.0.0.18	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.872034	2026-06-29 18:34:20.872034	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/COMPRESSORPT2	azure	2026-06-29 18:34:20.81
42	EntraCloudConnect	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_F2s_v2	Windows	10.0.0.15	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.876436	2026-06-29 18:34:20.876436	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/EntraCloudConnect	azure	2026-06-29 18:34:20.81
43	Goverlan	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_E2s_v3	Windows	10.0.0.16	172.169.60.238	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.879906	2026-06-29 18:34:20.879906	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/Goverlan	azure	2026-06-29 18:34:20.81
44	GSYNC0	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	Windows	10.0.0.21	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.883471	2026-06-29 18:34:20.883471	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/GSYNC0	azure	2026-06-29 18:34:20.81
45	KEYSTONE	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	Windows	10.0.0.20	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.888182	2026-06-29 18:34:20.888182	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/KEYSTONE	azure	2026-06-29 18:34:20.81
46	lucas-flare	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D4as_v5	Windows	10.0.0.28	4.150.203.199	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.891369	2026-06-29 18:34:20.891369	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/lucas-flare	azure	2026-06-29 18:34:20.81
47	LUCAS-KALI	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_DS3_v2	Linux	10.0.0.10	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.894542	2026-06-29 18:34:20.894542	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/LUCAS-KALI	azure	2026-06-29 18:34:20.81
48	MFS0	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2ds_v4	Windows	10.0.0.32	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.89799	2026-06-29 18:34:20.89799	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/MFS0	azure	2026-06-29 18:34:20.81
49	netedit	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A1_v2	Linux	10.0.0.14	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.901204	2026-06-29 18:34:20.901204	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/netedit	azure	2026-06-29 18:34:20.81
50	New-TrendMicroA	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	service-gateway-appliance-preview-vm service-gateway-appliance-azure-image	10.0.0.38	\N	Hybrid-VNet	Hybrid_default	deallocated	\N	\N	\N	1	2026-06-29 18:34:20.903829	2026-06-29 18:34:20.903829	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/New-TrendMicroA	azure	2026-06-29 18:34:20.81
51	ONERING16	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2a_v4	Windows	10.0.0.23	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.906983	2026-06-29 18:34:20.906983	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/ONERING16	azure	2026-06-29 18:34:20.81
52	PRNTSP2	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2ds_v4	Windows	10.0.0.30	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.909637	2026-06-29 18:34:20.909637	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/PRNTSP2	azure	2026-06-29 18:34:20.81
53	PTEC2	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2_v4	Windows	10.0.0.24	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.913465	2026-06-29 18:34:20.913465	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/PTEC2	azure	2026-06-29 18:34:20.81
54	SalonIRIS	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2ds_v4	Windows	10.0.0.36	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.918933	2026-06-29 18:34:20.918933	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/SalonIRIS	azure	2026-06-29 18:34:20.81
55	SCCCMFS01	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	windows-server-2022-datacenter windows-server-2022-datacenter	10.0.0.8	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.922281	2026-06-29 18:34:20.922281	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/SCCCMFS01	azure	2026-06-29 18:34:20.81
56	SteamPT-License-Server	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2as_v5	Windows	10.0.0.13	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.926542	2026-06-29 18:34:20.926542	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/SteamPT-License-Server	azure	2026-06-29 18:34:20.81
57	Syslog-Forwarder	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A2_v2	Linux	10.0.0.37	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.929547	2026-06-29 18:34:20.929547	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/Syslog-Forwarder	azure	2026-06-29 18:34:20.81
58	TRACDAT2	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A2_v2	Windows	10.0.0.25	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.931864	2026-06-29 18:34:20.931864	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/TRACDAT2	azure	2026-06-29 18:34:20.81
59	TRENDV1SVCGW	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	Linux	10.0.0.19	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.934215	2026-06-29 18:34:20.934215	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/TRENDV1SVCGW	azure	2026-06-29 18:34:20.81
60	WAC	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	Windows-10 win10-22h2-ent-g2	10.0.0.35	20.80.72.179	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.937104	2026-06-29 18:34:20.937104	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/WAC	azure	2026-06-29 18:34:20.81
61	WDS-New	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2as_v5	Windows	10.0.0.7	\N	Hybrid-VNet	Hybrid_default	deallocated	\N	\N	\N	1	2026-06-29 18:34:20.940016	2026-06-29 18:34:20.940016	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/WDS-New	azure	2026-06-29 18:34:20.81
62	WEB	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A2_v2	Windows	10.0.0.26	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.94255	2026-06-29 18:34:20.94255	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/WEB	azure	2026-06-29 18:34:20.81
63	WEB-LIVE2	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2as_v5	Windows	10.0.0.27	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.945094	2026-06-29 18:34:20.945094	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/WEB-LIVE2	azure	2026-06-29 18:34:20.81
64	WSUS	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_E2s_v3	Windows	10.0.0.17	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.947294	2026-06-29 18:34:20.947294	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/WSUS	azure	2026-06-29 18:34:20.81
65	XMAIL16-New	HYBR0D-NETWORK	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D4as_v4	Windows	10.0.0.31	\N	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.950205	2026-06-29 18:34:20.950205	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/HYBR0D-NETWORK/providers/Microsoft.Compute/virtualMachines/XMAIL16-New	azure	2026-06-29 18:34:20.81
66	Hybrid-testVm01	RG-PROD-CENTRALUS	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_DS1_v2	WindowsServer 2019-datacenter-gensecond	10.0.0.9	172.202.115.228	Hybrid-VNet	Hybrid_default	deallocated	\N	\N	\N	1	2026-06-29 18:34:20.95249	2026-06-29 18:34:20.95249	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/Hybrid-testVm01	azure	2026-06-29 18:34:20.81
67	KMS	RG-PROD-CENTRALUS	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_A1_v2	Windows	10.0.0.4	132.196.97.226	Hybrid-VNet	Hybrid_default	running	\N	\N	\N	1	2026-06-29 18:34:20.954806	2026-06-29 18:34:20.954806	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/KMS	azure	2026-06-29 18:34:20.81
68	OITJUMP02	RG-PROD-CENTRALUS	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D4s_v4	Windows	10.40.1.248	\N	vnet_NEW	104_Subnet_10.40.1.0	deallocated	\N	\N	\N	1	2026-06-29 18:34:20.957223	2026-06-29 18:34:20.957223	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/OITJUMP02	azure	2026-06-29 18:34:20.81
69	PROD-IIS-WEB01	RG-PROD-CENTRALUS	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v5	WindowsServer 2022-datacenter	10.110.1.4	130.131.156.14	vnet-prod-web	subnet-web	running	\N	\N	\N	1	2026-06-29 18:34:20.960135	2026-06-29 18:34:20.960135	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/PROD-IIS-WEB01	azure	2026-06-29 18:34:20.81
70	Test-1	RG-PROD-CENTRALUS	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_DS1_v2	WindowsServer 2022-datacenter-azure-edition-core	10.0.0.6	\N	Hybrid-VNet	Hybrid_default	deallocated	\N	\N	\N	1	2026-06-29 18:34:20.962653	2026-06-29 18:34:20.962653	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/RG-PROD-CENTRALUS/providers/Microsoft.Compute/virtualMachines/Test-1	azure	2026-06-29 18:34:20.81
71	AzADC001	SCCC_DOMAIN_SERVICES	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	WindowsServer 2022-datacenter-azure-edition	10.0.0.6	40.67.170.222	aadds-vnet	aadds-subnet	deallocated	\N	\N	\N	1	2026-06-29 18:34:20.967305	2026-06-29 18:34:20.967305	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_DOMAIN_SERVICES/providers/Microsoft.Compute/virtualMachines/AzADC001	azure	2026-06-29 18:34:20.81
72	IIS-VM	SCCC_DOMAIN_SERVICES	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_B2ms	windows-server-2022-datacenter windows-server-2022-datacenter	10.0.0.8	52.173.23.138	aadds-vnet	aadds-subnet	running	\N	\N	\N	1	2026-06-29 18:34:20.969611	2026-06-29 18:34:20.969611	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/SCCC_DOMAIN_SERVICES/providers/Microsoft.Compute/virtualMachines/IIS-VM	azure	2026-06-29 18:34:20.81
73	canva-Backup	TEST	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2as_v4	windowsserver2022 2022-datacenter-g2	10.2.0.5	135.233.56.80	test-gateway-vnet	default	running	\N	\N	\N	1	2026-06-29 18:34:20.972468	2026-06-29 18:34:20.972468	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/TEST/providers/Microsoft.Compute/virtualMachines/canva-Backup	azure	2026-06-29 18:34:20.81
74	test-gateway	TEST	1d602111-1398-40e7-9555-baf6a406975d	centralus	Standard_D2s_v3	openvpnas openvpnas	10.2.0.4	128.203.233.52	test-gateway-vnet	default	running	\N	\N	\N	1	2026-06-29 18:34:20.974839	2026-06-29 18:34:20.974839	/subscriptions/1d602111-1398-40e7-9555-baf6a406975d/resourceGroups/TEST/providers/Microsoft.Compute/virtualMachines/test-gateway	azure	2026-06-29 18:34:20.81
\.


--
-- Data for Name: entries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.entries (id, user_id, category, title, description, accomplishments, challenges, support_needed, ticket_count, week_of, entry_date, tags, is_submitted, created_at, updated_at, completed_items, zendesk_ticket_ids) FROM stdin;
1	1	helpdesk	Help Desk Daily Operations	Resolved 8 tickets related to password resets, printer issues, and VPN access problems.	All tickets resolved within SLA	High volume of password resets during Monday morning.	\N	8	2026-04-14	2026-04-14	[]	f	2026-04-18 02:15:08.547589	2026-04-18 02:15:08.547589	[]	[]
4	1	general	Monday's suck	(See completed items list)	\N	\N	\N	0	2026-04-13	2026-04-20	[]	f	2026-04-20 17:37:40.449289	2026-04-20 17:37:40.449289	[{"title":"Brightsign Graduation Streaming","notes":"Set up strategy to stream for graduation for all SU buildings","category":"research_issue"},{"title":"Set up Logging application for team ","notes":"Built application for weekly reproting...","category":"task"}]	[]
24	7	general	Weekly Log – week of 2026-04-20	(See completed items list)	\N	\N	\N	1	2026-04-20	2026-04-20	[]	f	2026-04-20 18:15:46.727556	2026-04-20 18:36:52.582	[]	[5587]
28	1	network	Alot of work 	Fixed baseball	\N	Cecil 	none 	0	2026-04-20	2026-04-20	[]	f	2026-04-22 17:56:39.076768	2026-04-22 17:56:39.076768	[]	[]
\.


--
-- Data for Name: log_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.log_items (id, user_id, item_date, week_of, title, category, notes, weekly_entry_id, created_at, updated_at) FROM stdin;
2	1	2026-04-20	2026-04-20	Brightsign Streaming for Graduation	research_issue	Helped to create a process for streaming live from sports site, to be used in graduation	28	2026-04-20 18:31:17.775987	2026-04-20 18:31:17.775987
3	1	2026-04-20	2026-04-20	Firewall Analysis	task	Found issues, and problems with firewall configuration to be resovled.	28	2026-04-20 18:32:00.088408	2026-04-20 18:32:00.088408
6	1	2026-04-20	2026-04-20	Created Centralized tool to collect work in progress	task	Built site for team	28	2026-04-20 21:00:33.332967	2026-04-20 21:00:33.332967
4	7	2026-04-17	2026-04-13	stable-link-test 1776709994286	task	\N	24	2026-04-20 18:34:00.715954	2026-04-22 22:54:58.27
\.


--
-- Data for Name: network_layout_positions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.network_layout_positions (node_id, x, y, width, height, updated_at, updated_by) FROM stdin;
hobble-fortigate	18	44	180	70	2026-04-24 03:41:03.426	1
spine-internet	392.84738	-167.37553	240	\N	2026-04-24 03:41:12.609	1
s-28	18	44	180	70	2026-04-24 03:41:16.939	1
b-Student Health Center	206.85437	419.84543	216	226	2026-04-24 03:41:19.941	1
b-West Campus	695.3825	-25.128544	414	312	2026-04-24 03:41:26.427	1
s-34	11.876505	40.8233	180	70	2026-04-24 03:41:30.346	1
s-38	28.205826	31.75301	180	70	2026-04-24 03:41:50.65	1
b-Azure	39.660583	-800.09674	216	132	2026-04-24 04:19:05.043	1
s-37	216	44	180	70	2026-04-24 04:22:16.645	1
b-Softball Field	913.523	-392.35883	216	132	2026-06-23 20:29:28.22	1
s-35	18	138	180	70	2026-06-23 20:29:41.594	1
s-32	27.585371	36.81097	180	70	2026-06-23 20:30:05.522	1
s-20	212.6581	40.84958	180	70	2026-06-25 18:57:33.734	1
b-Cosmetology	-1067.4562	-182.37912	216	226	2026-06-25 18:57:49.708	1
b-Baseball Field	-932.03564	-359.50058	216	132	2026-06-25 18:58:02.867	1
b-B Building	-921.7855	-3.5641134	216	132	2026-06-25 18:58:06.529	1
cv-20	-817.33844	434.3937	200	\N	2026-06-25 18:58:11.618	1
cv-21	-721.48425	210.92249	200	\N	2026-06-25 18:58:20.104	1
b-Industrial Tech	763.88525	516.8695	414	398	2026-06-25 18:58:47.778	1
b-Student Living	1395.5299	451.99078	414	304	2026-06-25 18:58:56.036	1
b-Sharp Champion Center	916.78973	116.78396	216	226	2026-06-25 18:58:58.722	1
b-Humanities	-480.50458	363.0829	216	226	2026-06-25 18:59:04.07	1
b-Epworth ALC	-555.6351	125.19417	414	132	2026-06-25 18:59:07.042	1
b-Maintenance Building	1261.35	-112.54848	216	132	2026-06-25 18:59:11.749	1
\.


--
-- Data for Name: network_switches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.network_switches (id, hostname, building, ip_address, model, status, config_file, notes, location, last_seen, created_at, updated_at, maintenance_log) FROM stdin;
7	swa-h128	Humanities (H128)	10.70.89.1	Aruba	online	swa-h128.sccc.edu	Humanities H128 access	\N	\N	2026-04-18 02:02:04.723728	2026-04-18 02:02:04.723728	[]
8	SW-COS109	Cosmetology (COS109)	192.168.2.171	Aruba	online	sw-cos109.sccc.edu		\N	\N	2026-04-18 02:02:08.461898	2026-04-18 02:02:08.461898	[]
9	swa-scc	Sharp Champion Center	192.168.2.203	Aruba	online	swa-scc.sccc.edu		\N	\N	2026-04-18 02:02:12.31232	2026-04-18 02:02:12.31232	[]
10	SWA-SU121	Student Union (SU121)	192.168.2.200	Aruba	online	swa-su121.sccc.edu		\N	\N	2026-04-18 02:02:16.046953	2026-04-18 02:02:16.046953	[]
11	SWA-SLC151	Student Living Center (SLC151)	192.168.2.175	Aruba	online	swa-slc151.sccc.edu	Dorms	\N	\N	2026-04-18 02:02:19.7951	2026-04-18 02:02:19.7951	[]
12	swa-t122	Industrial Tech (T122)	192.168.2.190	Aruba	online	swa-t122.sccc.edu	Tech T122 mgmt	\N	\N	2026-04-18 02:02:23.627527	2026-04-18 02:02:23.627527	[]
13	sw-t122-T48	Industrial Tech (T122)	192.168.2.72	Cisco Nexus	online	sw-t122-a48.sccc.edu	Tech Core 3	\N	\N	2026-04-18 02:02:27.428979	2026-04-18 02:02:27.428979	[]
14	sw-t122-T24	Industrial Tech (T122)	192.168.2.73	Cisco Nexus	online	sw-t122-a24.sccc.edu	Tech Core 4	\N	\N	2026-04-18 02:02:31.296763	2026-04-18 02:02:31.296763	[]
15	swa-ta107	Tech (TA107)	192.168.2.189	Aruba	online	swa-ta107.sccc.edu		\N	\N	2026-04-18 02:02:35.027625	2026-04-18 02:02:35.027625	[]
16	swa-tt103	Tech (TT103)	192.168.2.188	Aruba	online	swa-tt103.sccc.edu		\N	\N	2026-04-18 02:02:38.888873	2026-04-18 02:02:38.888873	[]
17	swa-tb141	Tech B141	192.168.2.186	Aruba	online	swa-tb141.sccc.edu		\N	\N	2026-04-18 02:02:42.672628	2026-04-18 02:02:42.672628	[]
18	swa-td201	Tech D201	192.168.2.187	Aruba	online	swa-td201.sccc.edu		\N	\N	2026-04-18 02:02:46.378732	2026-04-18 02:02:46.378732	[]
19	SWA-SLJ	Student Living (SLJ)	192.168.2.181	Aruba	online	swa-slj.sccc.edu	Tech Dorm J	\N	\N	2026-04-18 02:02:50.108757	2026-04-18 02:02:50.108757	[]
20	SWA-SLH	Student Living (SLH)	192.168.2.180	Aruba	online	swa-slh.sccc.edu	Hale Court	\N	\N	2026-04-18 02:02:53.803126	2026-04-18 02:02:53.803126	[]
21	SWA-SLR	Student Living (SLR)	192.168.2.182	Aruba	online	swa-slr.sccc.edu		\N	\N	2026-04-18 02:02:57.577725	2026-04-18 02:02:57.577725	[]
22	SWA-SLS	Student Living (SLS)	192.168.2.183	Aruba	online	swa-sls.sccc.edu		\N	\N	2026-04-18 02:03:01.330083	2026-04-18 02:03:01.330083	[]
23	SWA-SLT	Student Living (SLT)	192.168.2.184	Aruba	online	swa-slt.sccc.edu		\N	\N	2026-04-18 02:03:05.053016	2026-04-18 02:03:05.053016	[]
24	SWA-SLG	Student Living (SLG)	192.168.2.179	Aruba	online	swa-slg.sccc.edu		\N	\N	2026-04-18 02:03:09.005998	2026-04-18 02:03:09.005998	[]
25	SWA-SLF	Tech Building F	192.168.2.178	Aruba	online	swa-slf.sccc.edu	Hale Court	\N	\N	2026-04-18 02:03:12.818701	2026-04-18 02:03:12.818701	[]
26	swa-m201	Agriculture (V201)	192.168.2.195	Aruba	online	swa-m201.sccc.edu	Verify V vs M naming	\N	\N	2026-04-18 02:03:16.648897	2026-04-18 02:03:16.648897	[]
27	SW-SoftBallPB	Softball Field	192.168.2.204	Aruba	online	sw-softballPB.sccc.edu		\N	\N	2026-04-18 02:03:20.4196	2026-04-18 02:03:20.4196	[]
28	sw-healthcenter	Student Health Center	192.168.2.212	Aruba	online	sw-healthcenter-aruba.sccc.edu		\N	\N	2026-04-18 02:03:24.261507	2026-04-18 02:03:24.261507	[]
31	B-Boiler	B Building (Boiler Room)	192.168.2.196	Aruba	offline		Expected but missing live	\N	\N	2026-04-18 02:03:35.418193	2026-04-18 02:03:35.418193	[]
32	Baseball-Pressbox	Baseball Field	192.168.2.27	Aruba	online			\N	\N	2026-04-18 02:03:39.149568	2026-04-18 02:03:39.149568	[]
33	Maintenance	Maintenance Building	192.168.2.205	Aruba	online			\N	\N	2026-04-18 02:03:43.026708	2026-04-18 02:03:43.026708	[]
34	West_FGT	West Campus	172.25.0.1	FortiGate (West edge)	unknown	\N	IPsec to HQ Fortigate1-Sccc; ~28 Phase 2 selectors, 14 up; investigate ~240k TX errors (MTU/path).	West Campus IDF	\N	2026-04-22 23:00:48.923585	2026-04-22 23:00:48.923585	[]
36	Hybrid-VPNGateway	Azure (Hybrid-VNet)	10.0.0.225	Azure VPN Gateway (VpnGw2AZ, RouteBased, Active/Active)	online	\N	S2S-OnPrem connection to OnPrem-LNG (207.178.111.98). NAT rule OnPrem-SNAT: 10.1.0.0/24 -> 172.20.1.0/26 (EgressSnat). Public tunnel endpoints e.g. 48.214.x.x.	Azure Central US — GatewaySubnet 10.0.0.224/27	\N	2026-04-22 23:00:48.923585	2026-04-22 23:00:48.923585	[]
37	Hybrid-NatGW01	Azure (Hybrid-VNet)	10.0.0.0	Azure NAT Gateway	online	\N	Egress NAT for Hybrid_default workload subnet. UDR RT-To-Onprem sends 10.70.0.0/16 and 192.168.0.0/16 to VirtualNetworkGateway.	Hybrid_default subnet (10.0.0.0/25)	\N	2026-04-22 23:00:48.923585	2026-04-22 23:00:48.923585	[]
38	OnPrem-LNG	Azure (Hybrid-VNet)	207.178.111.98	Azure Local Network Gateway	online	\N	Address prefixes include 172.25.0.0/21, 172.25.0.0/24..172.25.6.0/24, plus extensive 10.x, 172.16/18/20/23, and 192.168.0.0/16. Confirm in portal before edits.	Azure object — represents on-prem peer	\N	2026-04-22 23:00:48.923585	2026-04-22 23:00:48.923585	[]
1	sw-aa144-A48	Hobble	192.168.2.70	Cisco Nexus	online	sw-aa144-a48.sccc.edu	Nexus Core 1	\N	\N	2026-04-18 02:01:41.539105	2026-04-18 02:01:41.539105	[]
2	sw-aa144-A24	Hobble	192.168.2.71	Cisco Nexus	online	sw-aa144-a24.sccc.edu	Nexus Core 2	\N	\N	2026-04-18 02:01:45.379229	2026-04-18 02:01:45.379229	[]
3	SW-A144-1-Aruba	Hobble	192.168.2.201	Aruba 6300	online	sw-A144-1-aruba.sccc.edu	Hobble access stack 1	\N	\N	2026-04-18 02:01:49.496064	2026-04-18 02:01:49.496064	[]
4	SW-A144-2-Aruba	Hobble	192.168.2.202	Aruba 6300	online	sw-A144-2-aruba.sccc.edu	Hobble access stack 2	\N	\N	2026-04-18 02:01:53.419753	2026-04-18 02:01:53.419753	[]
5	FortiGate	Hobble	192.168.1.1	FortiGate Firewall	online	fortigate-running.conf	Primary firewall	\N	\N	2026-04-18 02:01:57.249306	2026-04-18 02:01:57.249306	[]
6	SW-AA144-Access	Hobble	192.168.2.40	Aruba 6100	offline	sw-aa144-access.sccc.edu	Expected but missing live	\N	\N	2026-04-18 02:02:00.994655	2026-04-18 02:02:00.994655	[]
29	SWA-AA105	Hobble	192.168.2.199	Aruba	online	swa-aa105.sccc.edu	SVI: 10.70.34.1	\N	\N	2026-04-18 02:03:27.957797	2026-04-18 02:03:27.957797	[]
30	swa-a161	Hobble	192.168.2.197	Aruba	online	swa-a161.sccc.edu	Testing Center	\N	\N	2026-04-18 02:03:31.630737	2026-04-18 02:03:31.630737	[]
35	Fortigate1-Sccc	Hobble	192.168.1.1	FortiGate (HQ)	online	\N	HQ policy hub. IPsec to West (West_FGT) and Azure (Azure-SCCC2). Address objects: West_All, InternalAzure (10.0.0.0/25). Policies 222/223 (West<->campus), 229 (campus->Azure), 244/245/246/248 (West<->Azure).	Hobble AA-158 — IT room	\N	2026-04-22 23:00:48.923585	2026-04-22 23:00:48.923585	[]
\.


--
-- Data for Name: processes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.processes (id, title, slug, category, summary, content, tags, created_by, updated_by, created_at, updated_at) FROM stdin;
1	Offboard a departing employee	offboard-a-departing-employee	offboarding	Updated summary	1. Disable AD account\n2. Forward email to manager\n3. Revoke M365 license\n4. Close out tickets	["ad","m365","ticket"]	7	7	2026-04-20 19:54:23.780879	2026-04-20 19:54:40.868
\.


--
-- Data for Name: project_assignees; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_assignees (project_id, user_id) FROM stdin;
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.projects (id, title, description, status, progress, target_date, new_estimated_date, attachments, created_by, created_at, updated_at, pending_decisions, strategic_objective_ids, progress_log) FROM stdin;
1	Backlink Test 97241	\N	in_progress	50	\N	\N	[]	1	2026-04-24 00:05:17.514323	2026-04-24 00:16:45.506	[]	[1]	[{"date":"2026-04-24T00:16:45.506Z","value":50}]
\.


--
-- Data for Name: quotes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.quotes (id, text, author, category, created_at) FROM stdin;
1	The best way to predict the future is to invent it.	Alan Kay	innovation	2026-04-18 02:50:16.29687
2	Simplicity is the ultimate sophistication.	Leonardo da Vinci	design	2026-04-18 02:50:16.29687
3	First, solve the problem. Then, write the code.	John Johnson	engineering	2026-04-18 02:50:16.29687
4	Code is read much more often than it is written.	Guido van Rossum	engineering	2026-04-18 02:50:16.29687
5	There are two ways to write error-free programs; only the third one works.	Alan J. Perlis	humor	2026-04-18 02:50:16.29687
6	The most damaging phrase in the language is "we've always done it this way."	Grace Hopper	leadership	2026-04-18 02:50:16.29687
7	A ship in port is safe, but that's not what ships are built for.	Grace Hopper	leadership	2026-04-18 02:50:16.29687
8	Make it work, make it right, make it fast.	Kent Beck	engineering	2026-04-18 02:50:16.29687
9	Premature optimization is the root of all evil.	Donald Knuth	engineering	2026-04-18 02:50:16.29687
10	Any sufficiently advanced technology is indistinguishable from magic.	Arthur C. Clarke	innovation	2026-04-18 02:50:16.29687
11	Walking on water and developing software from a specification are easy if both are frozen.	Edward V. Berard	humor	2026-04-18 02:50:16.29687
12	It's not a bug; it's an undocumented feature.	Anonymous	humor	2026-04-18 02:50:16.29687
13	In God we trust. All others must bring data.	W. Edwards Deming	leadership	2026-04-18 02:50:16.29687
14	Without data, you're just another person with an opinion.	W. Edwards Deming	leadership	2026-04-18 02:50:16.29687
15	The function of leadership is to produce more leaders, not more followers.	Ralph Nader	leadership	2026-04-18 02:50:16.29687
16	Security is always going to be a cat and mouse game.	Mikko Hypponen	security	2026-04-18 02:50:16.29687
17	The only truly secure system is one that is powered off, cast in a block of concrete and sealed in a lead-lined room with armed guards.	Gene Spafford	security	2026-04-18 02:50:16.29687
18	Good documentation is like sex: when it is good, it is very, very good; when it is bad, it is better than nothing.	Dick Brandon	humor	2026-04-18 02:50:16.29687
19	A user interface is like a joke. If you have to explain it, it's not that good.	Martin LeBlanc	design	2026-04-18 02:50:16.29687
20	Programs must be written for people to read, and only incidentally for machines to execute.	Harold Abelson	engineering	2026-04-18 02:50:16.29687
21	The network is the computer.	John Gage	networking	2026-04-18 02:50:16.29687
22	Networks are the foundation of communication. Without them, nothing moves.	Anonymous	networking	2026-04-18 02:50:16.29687
23	Service to others is the rent you pay for your room here on earth.	Muhammad Ali	leadership	2026-04-18 02:50:16.29687
24	Quality is never an accident; it is always the result of intelligent effort.	John Ruskin	leadership	2026-04-18 02:50:16.29687
25	The strength of the team is each individual member. The strength of each member is the team.	Phil Jackson	teamwork	2026-04-18 02:50:16.29687
\.


--
-- Data for Name: reports; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.reports (id, week_of, title, status, summary, accomplishments, challenges, strategic_progress, next_week_plans, metrics, contributor_count, entry_count, created_by, finalized_at, created_at, updated_at, selected_item_ids, custom_tasks, project_ids, selected_after_action_ids, selected_maintenance_ids, include_goal_progress, include_open_risks, email_recipients, last_emailed_at, selected_risk_ids) FROM stdin;
1	2026-04-14	\N	draft	\N	\N	\N	\N	\N	{}	0	0	1	\N	2026-04-18 02:15:08.57498	2026-04-18 02:15:08.57498	[]	[]	[]	null	null	t	t	[]	\N	null
2	2026-04-20	\N	draft	\N	\N	\N	\N	\N	{}	0	0	1	\N	2026-04-20 16:23:33.127196	2026-04-20 16:23:33.127196	[]	[]	[]	null	null	t	t	[]	\N	null
3	2026-04-20	\N	draft	\N	\N	\N	\N	\N	{}	0	0	1	\N	2026-04-20 18:39:35.613459	2026-04-20 18:39:35.613459	[]	[]	[]	null	null	t	t	[]	\N	null
4	2026-04-20	\N	draft	\N	\N	\N	\N	\N	{}	0	0	1	\N	2026-04-20 18:40:13.976	2026-04-20 18:40:13.976	[]	[]	[]	null	null	t	t	[]	\N	null
5	2026-04-20		draft	Automation summary					{}	0	0	1	\N	2026-04-20 18:47:06.6802	2026-04-20 18:47:20.635	[]	[]	[]	null	null	t	t	[]	\N	null
6	2026-04-20	\N	draft	\N	\N	\N	\N	\N	{}	0	0	1	\N	2026-04-22 17:56:56.697461	2026-04-22 17:56:56.697461	[]	[]	[1]	null	null	t	t	[]	\N	null
\.


--
-- Data for Name: risks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.risks (id, user_id, type, severity, status, title, description, impact, mitigation, related_building, related_device, shared_with, created_at, updated_at, probability, category, project_id, archived_at) FROM stdin;
1	1	risk	medium	open	Aging switch in B-Boiler room	Switch is offline, may need replacement.	\N	\N	\N	\N	[]	2026-04-18 02:13:21.471335	2026-04-18 02:13:21.471335	medium	other	\N	\N
2	7	risk	high	open	Updated risk title	DB upgrade may impact registration	\N	\N	\N	\N	[]	2026-04-20 18:01:16.91088	2026-04-20 18:01:17.212	low	network	\N	\N
3	7	risk	high	open	Banner DB upgrade window	May impact registration during upgrade window	Potential registration delays	Schedule outside peak registration if possible	\N	\N	[]	2026-04-20 18:04:38.794967	2026-04-20 18:05:16.642	low	network	\N	\N
4	7	risk	medium	mitigated	Banner outage risk	test	\N	\N	\N	\N	[]	2026-04-20 18:17:34.743824	2026-04-20 18:18:04.116	low	banner	\N	\N
\.


--
-- Data for Name: strategic_objectives; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.strategic_objectives (id, title, description, status, created_by, created_at, updated_at) FROM stdin;
1	Modernize Network	Upgrade core switches	active	1	2026-04-24 00:16:45.395897	2026-04-24 00:16:45.395897
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, password_hash, name, role, department, created_at, updated_at, zendesk_email, password_reset_token, password_reset_expires, is_active) FROM stdin;
27	aitest-31648@sccc.edu	$2b$10$rzyv82/9DjeC.EMzP/6j9ezAbYk3s1CY69vUeXxrelkdqbcIeP17.	AI Test	cio	IT	2026-07-02 03:50:27.644038	2026-07-02 03:50:27.644038	\N	\N	\N	f
13	cio2-prtIA0-H@sccc.edu	$2b$10$Cj.00FBF8xEEZUID1rb3TuM/V/j9rIvcgSevbOJQqVR9UeKU0hQte	Test CIO prtIA0-H	cio	\N	2026-04-24 03:51:03.155173	2026-04-24 05:18:18.286	\N	\N	\N	t
1	mark.bojeun@sccc.edu	$2b$10$9DDPgwihECIUWKBDwS1Gtuvssa3UoJnkcp8HhWdpUTq1mDy6CxKZ6	Mark Bojeun	cio	IT Leadership	2026-04-18 02:12:02.160515	2026-04-20 18:44:59.867	\N	\N	\N	t
15	qa_jayoym@sccc.edu	$2b$10$3PwUUOaql51TqVgZJXBnKufeOlHnCo7o5Knbt1yV4WNWotxO75x6e	QA Tester	helpdesk	IT Services	2026-06-24 05:43:47.627128	2026-06-24 05:43:47.627128	\N	\N	\N	f
16	qa_mral9o@sccc.edu	$2b$10$hjfPZ3wp9fFIxttNhIAg7uIYjwNMCkcFHtFN.TMx3Yftdv7qIqt0G	QA Tester	helpdesk	IT Services	2026-06-24 05:45:02.490055	2026-06-24 05:45:02.490055	\N	\N	\N	t
14	cio3-LXolDF7N@sccc.edu	$2b$10$G/6288tJdejYXIcrf4WQ/.8QfMaDsdxXfOrT.yf27co9p5OzW1lS6	Test CIO	cio	\N	2026-04-24 04:26:22.44201	2026-04-24 04:26:22.44201	\N	\N	\N	t
12	cio-test-6EFIzrf3@sccc.edu	$2b$10$qA60bHwA1Gjy2VZF2oGo0ur8fz7iwGMj4VgdJsMJ5bw3sJxAacSLW	Test CIO 6EFIzrf3	cio	\N	2026-04-24 03:48:01.29141	2026-04-24 05:16:57.518	\N	\N	\N	f
5	tracy.compaan@sccc.edu	$2b$10$OKmSgqSvQ0Q1Cl8FkYkzm.AJk1vCiHgK2LC/vLNmfOKlUdUkQcxsa	Tracy Compaan	helpdesk	Help Desk	2026-04-20 15:59:52.509258	2026-04-20 17:09:09.801	\N	\N	\N	t
6	cecil.stoll@sccc.edu	$2b$10$OKmSgqSvQ0Q1Cl8FkYkzm.AJk1vCiHgK2LC/vLNmfOKlUdUkQcxsa	Cecil Stoll	network_engineer	Network	2026-04-20 15:59:52.592908	2026-04-20 17:09:09.806	\N	\N	\N	t
7	craig.dusek@sccc.edu	$2b$10$OKmSgqSvQ0Q1Cl8FkYkzm.AJk1vCiHgK2LC/vLNmfOKlUdUkQcxsa	Craig Dusek	helpdesk	Help Desk	2026-04-20 15:59:52.595743	2026-04-20 17:09:09.81	\N	\N	\N	t
11	matt.song@sccc.edu	$2b$10$OKmSgqSvQ0Q1Cl8FkYkzm.AJk1vCiHgK2LC/vLNmfOKlUdUkQcxsa	Matt Song	staff	Project Management	2026-04-20 17:09:09.814321	2026-04-20 17:09:09.814321	matt_song@oculusit.com	\N	\N	t
9	illia.ivanov@sccc.edu	$2b$10$OKmSgqSvQ0Q1Cl8FkYkzm.AJk1vCiHgK2LC/vLNmfOKlUdUkQcxsa	Illia Ivanov	helpdesk	Help Desk	2026-04-20 15:59:52.603335	2026-04-20 17:09:09.816	\N	\N	\N	t
10	lucas.gonzalezram81@sccc.edu	$2b$10$OKmSgqSvQ0Q1Cl8FkYkzm.AJk1vCiHgK2LC/vLNmfOKlUdUkQcxsa	Lucas Gonzales	security_engineer	Network Security	2026-04-20 15:59:52.606115	2026-04-20 17:09:09.819	lucas.gonzalezram81@g.sccc.edu	\N	\N	t
\.


--
-- Data for Name: vlans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vlans (id, vlan_id, name, description, building, type, subnet, gateway, notes, created_at, maintenance_log) FROM stdin;
3	303	VOIP-SU	VOIP in SU121 & SA208	Student Union	voice	10.30.3.0/24	10.30.3.1	\N	2026-04-18 02:04:23.623181	[]
4	611	OSPF-TO-6509-CORESWITCH	OSPF to 6509 Core Switch	Core	ospf	172.20.2.0/30	172.20.2.1	\N	2026-04-18 02:04:27.378358	[]
5	612	OSPF-TO-9300NEXUS-BuildingT	OSPF to Industrial Tech Nexus	Industrial Tech	ospf	172.20.3.0/30	172.20.3.1	\N	2026-04-18 02:04:31.035847	[]
6	613	OSPF-H128-CiscoA48	OSPF Humanities H128	Humanities	ospf	172.20.2.4/30	172.20.2.5	\N	2026-04-18 02:04:34.676999	[]
7	616	OSPF10-Epworth	OSPF to Epworth ALC	Epworth ALC	ospf	172.20.2.16/30	172.20.2.17	\N	2026-04-18 02:04:38.541636	[]
8	617	OSPF10-TechSchool	OSPF to Tech School	Industrial Tech	ospf	172.20.2.20/30	172.20.2.21	\N	2026-04-18 02:04:42.257505	[]
9	618	OSPF10-SLC151-Dorms	OSPF to SLC151 Dorms	Student Living Center	ospf	172.20.2.24/30	172.20.2.25	\N	2026-04-18 02:04:46.068945	[]
10	619	OSPF10-V201	OSPF Agriculture V201	Agriculture	ospf	172.20.2.28/30	172.20.2.29	\N	2026-04-18 02:04:49.927841	[]
11	620	OSPF10-B101	OSPF Tech B101	Tech B Building	ospf	172.20.2.32/30	172.20.2.33	\N	2026-04-18 02:04:53.661975	[]
12	621	OSPF10-TA107	OSPF Tech TA107	Industrial Tech (TA107)	ospf	172.20.2.36/30	172.20.2.37	\N	2026-04-18 02:04:57.415159	[]
15	624	OSPF10-SharpCC	OSPF Sharp Champion Center	Sharp Champion Center	ospf	172.20.2.48/30	172.20.2.49	\N	2026-04-18 02:05:09.006096	[]
17	626	OSPF-SU121	OSPF Student Union SU121	Student Union	ospf	172.20.2.56/30	172.20.2.57	\N	2026-04-18 02:05:16.555066	[]
18	627	OSPF-COS109	OSPF Cosmetology COS109	Cosmetology	ospf	172.20.2.60/30	172.20.2.61	\N	2026-04-18 02:05:20.292591	[]
19	628	OSPF-Healthcenter	OSPF Health Center	Student Health Center	ospf	172.20.2.64/30	172.20.2.65	\N	2026-04-18 02:05:24.019054	[]
20	1	Management	In-band management VLAN	Campus-wide	management	192.168.0.0/16	192.168.2.1	\N	2026-04-18 02:05:27.727289	[]
21	17	VPC-Heartbeat	VPC peer heartbeat	Core	management	172.20.11.0/30	172.20.11.1	\N	2026-04-18 02:05:31.387409	[]
22	348	Camera-VLAN-1	Security cameras group 1	Campus-wide	security	\N	\N	\N	2026-04-18 02:05:35.168608	[]
23	372	AccessControl-1	Access control systems	Campus-wide	security	\N	\N	\N	2026-04-18 02:05:39.126703	[]
24	773	EpworthBuilding	Epworth ALC data VLAN	Epworth ALC	data	\N	\N	\N	2026-04-18 02:05:42.831017	[]
25	817	HVAC-Control	HVAC control systems	Campus-wide	other	\N	\N	\N	2026-04-18 02:05:46.607657	[]
26	818	Fire-Alarm	Fire alarm system VLAN	Campus-wide	security	\N	\N	\N	2026-04-18 02:05:50.355744	[]
27	910	West-Wired	West campus wired aggregate, IPsec via West_FGT/Fortigate1-Sccc. Member of FortiGate addr group West_All. Phase 2 West_17225_to_Azure ties this to Azure InternalAzure 10.0.0.0/25.	West Campus	data	172.25.1.0/24	\N	\N	2026-04-18 02:05:54.294938	[]
28	909	West_Wired (aggregate)	FortiGate object West_Wired. Listed on Azure OnPrem-LNG.	West Campus	data	172.25.0.0/24	\N	Aggregate 172.25.0.0/21 spans 172.25.0.0/24 .. 172.25.6.0/24.	2026-04-22 23:00:48.923585	[]
29	911	West_Wireless	FortiGate object West_Wireless. Member of West_All.	West Campus	data	10.11.16.0/24	\N	\N	2026-04-22 23:00:48.923585	[]
30	9001	Azure: Hybrid_default	Workload subnet for VMs / NICs / private endpoints. Aligns with FortiGate InternalAzure object.	Azure (Hybrid-VNet)	other	10.0.0.0/25	10.0.0.1	NAT Gateway Hybrid-NatGW01 attached. UDR RT-To-Onprem applied.	2026-04-22 23:00:48.923585	[]
31	9002	Azure: GatewaySubnet	Hosts Hybrid-VPNGateway (active/active VpnGw2AZ).	Azure (Hybrid-VNet)	other	10.0.0.224/27	\N	Required reserved name for Azure VPN/ExpressRoute gateways.	2026-04-22 23:00:48.923585	[]
32	9003	Azure: VNet 2nd prefix	Secondary address space on Hybrid-VNet.	Azure (Hybrid-VNet)	other	10.3.0.0/27	\N	\N	2026-04-22 23:00:48.923585	[]
33	9004	Azure UDR: To OnPrem (10.70/16)	Route 10.70.0.0/16 -> VirtualNetworkGateway via RT-To-Onprem.	Azure (Hybrid-VNet)	other	10.70.0.0/16	\N	\N	2026-04-22 23:00:48.923585	[]
34	9005	Azure UDR: To OnPrem (192.168/16)	Route 192.168.0.0/16 -> VirtualNetworkGateway via RT-To-Onprem.	Azure (Hybrid-VNet)	other	192.168.0.0/16	\N	\N	2026-04-22 23:00:48.923585	[]
1	301	VOIP-A144	VOIP in A144	Hobble	voice	10.30.1.0/24	10.30.1.1	\N	2026-04-18 02:04:16.047561	[]
2	302	VOIP-AA105	VOIP in AA105 & AA144	Hobble	voice	10.30.2.0/24	10.30.2.1	\N	2026-04-18 02:04:19.84166	[]
13	622	OSPF10-A144-1	OSPF Hobble A144 Stack 1	Hobble	ospf	172.20.2.40/30	172.20.2.41	\N	2026-04-18 02:05:01.176063	[]
14	623	OSPF10-A144-2	OSPF Hobble A144 Stack 2	Hobble	ospf	172.20.2.44/30	172.20.2.45	\N	2026-04-18 02:05:05.28677	[]
16	625	OSPF10-AA105	OSPF Hobble AA105	Hobble	ospf	172.20.2.52/30	172.20.2.53	\N	2026-04-18 02:05:12.858497	[]
\.


--
-- Name: after_action_reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.after_action_reports_id_seq', 1, false);


--
-- Name: ai_knowledge_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ai_knowledge_id_seq', 130, true);


--
-- Name: azure_resources_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.azure_resources_id_seq', 744, true);


--
-- Name: azure_vms_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.azure_vms_id_seq', 74, true);


--
-- Name: entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.entries_id_seq', 28, true);


--
-- Name: log_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.log_items_id_seq', 6, true);


--
-- Name: network_switches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.network_switches_id_seq', 38, true);


--
-- Name: processes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.processes_id_seq', 1, true);


--
-- Name: projects_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.projects_id_seq', 1, true);


--
-- Name: quotes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.quotes_id_seq', 25, true);


--
-- Name: reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reports_id_seq', 6, true);


--
-- Name: risks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.risks_id_seq', 6, true);


--
-- Name: strategic_objectives_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.strategic_objectives_id_seq', 1, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 27, true);


--
-- Name: vlans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vlans_id_seq', 34, true);


--
-- Name: after_action_reports after_action_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.after_action_reports
    ADD CONSTRAINT after_action_reports_pkey PRIMARY KEY (id);


--
-- Name: ai_knowledge ai_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_knowledge
    ADD CONSTRAINT ai_knowledge_pkey PRIMARY KEY (id);


--
-- Name: azure_resources azure_resources_azure_resource_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.azure_resources
    ADD CONSTRAINT azure_resources_azure_resource_id_unique UNIQUE (azure_resource_id);


--
-- Name: azure_resources azure_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.azure_resources
    ADD CONSTRAINT azure_resources_pkey PRIMARY KEY (id);


--
-- Name: azure_vms azure_vms_azure_resource_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.azure_vms
    ADD CONSTRAINT azure_vms_azure_resource_id_unique UNIQUE (azure_resource_id);


--
-- Name: azure_vms azure_vms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.azure_vms
    ADD CONSTRAINT azure_vms_pkey PRIMARY KEY (id);


--
-- Name: entries entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_pkey PRIMARY KEY (id);


--
-- Name: log_items log_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_items
    ADD CONSTRAINT log_items_pkey PRIMARY KEY (id);


--
-- Name: network_layout_positions network_layout_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.network_layout_positions
    ADD CONSTRAINT network_layout_positions_pkey PRIMARY KEY (node_id);


--
-- Name: network_switches network_switches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.network_switches
    ADD CONSTRAINT network_switches_pkey PRIMARY KEY (id);


--
-- Name: processes processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processes
    ADD CONSTRAINT processes_pkey PRIMARY KEY (id);


--
-- Name: project_assignees project_assignees_project_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignees
    ADD CONSTRAINT project_assignees_project_id_user_id_pk PRIMARY KEY (project_id, user_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: quotes quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: risks risks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risks
    ADD CONSTRAINT risks_pkey PRIMARY KEY (id);


--
-- Name: strategic_objectives strategic_objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategic_objectives
    ADD CONSTRAINT strategic_objectives_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vlans vlans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vlans
    ADD CONSTRAINT vlans_pkey PRIMARY KEY (id);


--
-- Name: entries_user_week_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX entries_user_week_unique ON public.entries USING btree (user_id, week_of);


--
-- Name: log_items_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX log_items_user_date_idx ON public.log_items USING btree (user_id, item_date);


--
-- Name: log_items_user_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX log_items_user_week_idx ON public.log_items USING btree (user_id, week_of);


--
-- Name: processes_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX processes_category_idx ON public.processes USING btree (category);


--
-- Name: processes_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX processes_slug_unique ON public.processes USING btree (slug);


--
-- Name: after_action_reports after_action_reports_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.after_action_reports
    ADD CONSTRAINT after_action_reports_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ai_knowledge ai_knowledge_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_knowledge
    ADD CONSTRAINT ai_knowledge_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: azure_resources azure_resources_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.azure_resources
    ADD CONSTRAINT azure_resources_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: azure_vms azure_vms_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.azure_vms
    ADD CONSTRAINT azure_vms_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: entries entries_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: log_items log_items_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_items
    ADD CONSTRAINT log_items_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: log_items log_items_weekly_entry_id_entries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_items
    ADD CONSTRAINT log_items_weekly_entry_id_entries_id_fk FOREIGN KEY (weekly_entry_id) REFERENCES public.entries(id);


--
-- Name: network_layout_positions network_layout_positions_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.network_layout_positions
    ADD CONSTRAINT network_layout_positions_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: processes processes_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processes
    ADD CONSTRAINT processes_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: processes processes_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processes
    ADD CONSTRAINT processes_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: project_assignees project_assignees_project_id_projects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignees
    ADD CONSTRAINT project_assignees_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_assignees project_assignees_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignees
    ADD CONSTRAINT project_assignees_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: projects projects_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: reports reports_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: risks risks_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risks
    ADD CONSTRAINT risks_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: strategic_objectives strategic_objectives_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategic_objectives
    ADD CONSTRAINT strategic_objectives_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict dynAb4LDk6baGRSDwm8cFaUJS0vpWTGQnXs56eKC3fgfB3nRTMnG0qKHV3RH4Wi

