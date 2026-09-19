// Every page loads without JS errors or 5xx, and a workflow runs through
// Co-pilot and Autopilot (Autopilot must stop at the email stage; nothing is
// ever sent - the email stage is skipped). The personalize stage makes one
// small AI call, so this spends well under a cent.
exports.title = 'Smoke: every page, Co-pilot and Autopilot runs';

const PAGES = ['/home', '/agents', '/dashboard', '/workflows', '/projects', '/usage', '/team', '/settings', '/market-research', '/sales-helper', '/content-marketing', '/event-networking', '/supply-chain-agent', '/executive-assistant', '/email-outreach', '/data-insights', '/community-network', '/campaign-dashboard', '/invest-agent'];

exports.run = async (t) => {
  const u = await t.newUser('smoke');
  const page = await t.page(u);
  const problems = [];
  page.on('pageerror', (e) => problems.push(`JS error: ${e.message.slice(0, 120)}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`${r.status()} ${r.url().replace(t.app, '')}`); });
  for (const p of PAGES) {
    problems.length = 0;
    await page.goto(`${t.app}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
    const text = (await page.locator('body').innerText()).trim();
    t.check(`${p}: renders, no JS errors / 5xx${problems.length ? ' -> ' + problems.join('; ') : ''}`, text.length > 20 && problems.length === 0);
  }

  const proj = (await t.request('POST', '/api/projects', u.token, { name: 'Smoke Project' })).json.project.id;
  t.onCleanup(async () => t.request('DELETE', `/api/projects/${proj}`, u.token));
  const mk = async (name) => {
    const id = (await t.request('POST', '/api/workflows/instances', u.token, { templateId: 'lead-nurture', projectId: proj, name, inputs: { qualify: { requirement: 'x', businesses: [] }, sequence: { businesses: [{ id: 'z', name: 'Nobody', email: 'nobody@enableyou.co' }], subject: 'Smoke', body: 'Smoke' } } })).json.instance.id;
    t.onCleanup(async () => t.request('DELETE', `/api/workflows/instances/${id}`, u.token));
    return id;
  };
  const waitFor = async (id, stage) => { for (let i = 0; i < 60; i++) { const p = (await t.request('GET', `/api/workflows/instances/${id}/pending-approval`, u.token)).json; if (p.pending && p.interrupt.stage_id === stage) return p.interrupt; await new Promise((x) => setTimeout(x, 1000)); } return null; };

  const wf1 = await mk('smoke copilot');
  await t.request('POST', `/api/workflows/instances/${wf1}/run`, u.token);
  t.check('co-pilot pauses at the first stage for approval', !!(await waitFor(wf1, 'qualify')));
  await t.request('POST', `/api/workflows/instances/${wf1}/resume`, u.token, { action: 'approve' });
  t.check('co-pilot: qualify with no leads is a visible skip and the next stage pauses', !!(await waitFor(wf1, 'personalize')));
  const inst1 = (await t.request('GET', `/api/workflows/instances/${wf1}`, u.token)).json.instance;
  t.check('qualify is recorded as skipped (not a green "done")', (inst1.stageStates || inst1.stage_states || {}).qualify?.outcome === 'skipped');

  const wf2 = await mk('smoke autopilot');
  await t.request('PATCH', `/api/workflows/instances/${wf2}/autonomy`, u.token, { mode: 'autopilot' });
  await t.request('POST', `/api/workflows/instances/${wf2}/run`, u.token);
  const seq = await waitFor(wf2, 'sequence');
  t.check('autopilot ran the earlier stages itself and stopped at the email stage', !!seq);
  t.check('the pause reason is "irreversible" (email is never auto-sent)', seq && seq.autopilot_pause_reason === 'irreversible' && seq.side_effect === 'irreversible');
  await t.request('POST', `/api/workflows/instances/${wf2}/resume`, u.token, { action: 'skip' });   // never approve: nothing is sent
  for (let i = 0; i < 30; i++) { const s = (await t.request('GET', `/api/workflows/instances/${wf2}`, u.token)).json.instance; if (s.status === 'completed') break; await new Promise((x) => setTimeout(x, 1000)); }
  t.check('the autopilot run completes once the email stage is skipped', (await t.request('GET', `/api/workflows/instances/${wf2}`, u.token)).json.instance.status === 'completed');
  const usage = (await t.request('GET', `/api/workflows/instances/${wf2}/usage`, u.token)).json;
  t.check('run usage: any spend is tiny and attributed to a stage', usage.success && usage.totalCostUsd < 0.05 && usage.byStageCall.every((c) => c.stageId));

  problems.length = 0;
  await page.goto(`${t.app}/workflows/${wf2}`); await page.waitForTimeout(2500);
  t.check('the completed run page renders', (await page.locator('.wf-stage-row').count()) >= 4 && problems.length === 0);

  const anon = await Promise.all(['/api/team/budget', '/api/usage/me/budget', '/api/usage/budget-status', '/api/workflows/instances', '/api/team/members/budgets'].map(async (p) => (await fetch(`${t.api}${p}`)).status));
  t.check('anonymous calls to budget / usage / workflow APIs are 401', anon.every((s) => s === 401));
};
