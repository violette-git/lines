-- LineMap Pro demo seed. Loaded by `supabase db reset` on a LOCAL development database only.
-- Contains no real people: the demo org has no members until you sign up locally and either
-- call create_organization() or add yourself (see bottom of this file).
--
-- Plans (the Stripe webhook keeps these in sync from the subscription; values mirror
-- PLAN_LIMITS in supabase/functions/stripe-webhook/index.ts):
--   trial       3 seats      50 AI photos / month   14 days, then AI stops until subscribed
--   starter     5 seats     500 AI photos / month
--   pro        25 seats    3000 AI photos / month
--   enterprise 100 seats  20000 AI photos / month   (or custom, set by hand)

insert into public.organizations (id, name, slug, plan, seat_limit, ai_monthly_photo_quota,
                                  subscription_status, trial_ends_at)
values ('00000000-0000-4000-8000-00000000d3e0', 'Demo Fiber Co', 'demo-fiber-co', 'pro', 25, 3000,
        'active', null)
on conflict (id) do nothing;

insert into public.client_templates (id, org_id, name, client, label_patterns, required_fields,
                                     default_span_kind, default_sag_pct, default_slack_ft,
                                     rate_per_foot, rate_per_node)
values ('00000000-0000-4000-8000-0000000071e1', '00000000-0000-4000-8000-00000000d3e0',
        'Example aerial template', 'Example Telco',
        '{"pole": "P-{seq}", "handhole": "HH-{seq}", "*": "{TYPE}-{seq}"}'::jsonb,
        '{"pole": ["pole_tag", "owner", "comm_attachment_count"]}'::jsonb,
        'aerial', 2, 0, 0.35, 4.00)
on conflict (id) do nothing;

insert into public.projects (id, org_id, name, client, job_number, work_type, notes, template_id, walk_mode)
values ('00000000-0000-4000-8000-0000000090e1', '00000000-0000-4000-8000-00000000d3e0',
        'Demo: Main Street aerial', 'Example Telco', 'JOB-0001', 'aerial',
        'Seeded demo project', '00000000-0000-4000-8000-0000000071e1', true)
on conflict (id) do nothing;

insert into public.nodes (id, org_id, project_id, seq, type, label, lat, lng, accuracy_m, gps_samples,
                          position_source, fields, status)
values
  ('00000000-0000-4000-8000-00000000a0d1', '00000000-0000-4000-8000-00000000d3e0',
   '00000000-0000-4000-8000-0000000090e1', 1, 'pole', 'P-1', 33.51860, -86.81040, 2.5, 8, 'gps_avg',
   '{"owner": "Power utility", "material": "Wood", "comm_attachment_count": 2}'::jsonb, 'reviewed'),
  ('00000000-0000-4000-8000-00000000a0d2', '00000000-0000-4000-8000-00000000d3e0',
   '00000000-0000-4000-8000-0000000090e1', 2, 'pole', 'P-2', 33.51905, -86.81120, 3.1, 8, 'gps_avg',
   '{"owner": "Joint use", "material": "Wood", "comm_attachment_count": 3}'::jsonb, 'reviewed'),
  ('00000000-0000-4000-8000-00000000a0d3', '00000000-0000-4000-8000-00000000d3e0',
   '00000000-0000-4000-8000-0000000090e1', 3, 'handhole', 'HH-3', 33.51950, -86.81190, 4.0, 4, 'gps_avg',
   '{"lid_label": "FIBER", "size": "17x30"}'::jsonb, 'draft')
on conflict (id) do nothing;

insert into public.spans (id, org_id, project_id, from_node_id, to_node_id, kind, sag_pct, slack_ft)
values
  ('00000000-0000-4000-8000-00000000550a', '00000000-0000-4000-8000-00000000d3e0',
   '00000000-0000-4000-8000-0000000090e1',
   '00000000-0000-4000-8000-00000000a0d1', '00000000-0000-4000-8000-00000000a0d2', 'aerial', 2, 0),
  ('00000000-0000-4000-8000-00000000550b', '00000000-0000-4000-8000-00000000d3e0',
   '00000000-0000-4000-8000-0000000090e1',
   '00000000-0000-4000-8000-00000000a0d2', '00000000-0000-4000-8000-00000000a0d3', 'underground', 0, 50)
on conflict (id) do nothing;

-- To join the demo org locally after signing up, run in the SQL editor (replace the uuid with
-- your own user id from Authentication > Users):
--   insert into public.org_members (org_id, user_id, role)
--   values ('00000000-0000-4000-8000-00000000d3e0', '<your-user-uuid>', 'owner');
