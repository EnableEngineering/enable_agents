// Personal / team / project budgets with "block" enforcement, the 402 + toast,
// a blocked workflow stage, and the per-stage cost view. Seeds usage rows
// directly, so dev only.
exports.title = 'Budgets: caps, blocking, per-stage cost';
exports.devOnly = 'seeds usage rows straight into the database';

exports.run = async (t) => {
  const u = await t.newUser('caps');
  const page = await t.page(u);
  const proj = (await t.request('POST', '/api/projects', u.token, { name: 'Cap Project' })).json.project.id;
  const paidRoute = () => t.request('POST', '/api/route-task', u.token, { task: 'find me suppliers' });   // refused before any provider when blocked

  // personal budget + enforcement toggle
  t.seedUsage({ user: u.email, cost: 1.0, project: proj });
  await page.goto(`${t.app}/usage`); await page.waitForSelector('.usage-summary-cards');
  t.check('no enforcement checkbox before a budget exists', (await page.locator('#usage-budget-block').count()) === 0);
  await page.locator('#usage-budget-input').fill('1.20');
  await page.locator('.usage-budget-save').click();
  await page.waitForSelector('#usage-budget-block');
  t.check('checkbox appears once a budget is set, unchecked by default', !(await page.locator('#usage-budget-block').isChecked()));
  await page.locator('#usage-budget-block').click();
  await page.waitForFunction(() => document.querySelector('.ea-toast__msg')?.textContent.includes('blocked once'));
  let st = (await t.request('GET', '/api/usage/me/budget', u.token)).json;
  t.check('enforcement saved as block, not blocking yet', st.budget.enforcement === 'block' && st.budget.blocking === false);

  // over the cap: badge, 402, toast
  t.seedUsage({ user: u.email, cost: 0.3, project: proj });
  await page.reload(); await page.waitForSelector('.usage-budget-amounts');
  t.check('badge says AI requests are blocked', /AI requests blocked/.test(await page.locator('.usage-card-section:has-text("My monthly budget")').textContent()));
  const blocked = await paidRoute();
  t.check('a paid route answers 402 budget_exceeded', blocked.status === 402 && blocked.json.code === 'budget_exceeded' && blocked.json.scope === 'user');
  t.check('the 402 carries the X-Budget-Blocked header', !!blocked.headers['x-budget-blocked']);
  await page.evaluate(() => fetch('http://localhost:5000/api/route-task', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('sessionToken')}` }, body: JSON.stringify({ task: 'x' }) }));
  await page.waitForSelector('.ea-toast--warning:has-text("monthly AI budget")', { timeout: 8000 });
  t.check('a toast explains which budget blocked it', true);

  // a real workflow stage that needs AI is refused, and says why
  const biz = [{ id: 'p1', name: 'Acme Fasteners', website: 'https://acme.example', phone: '+1-555-0100', address: '1 Main' }];
  const wf = (await t.request('POST', '/api/workflows/instances', u.token, { templateId: 'lead-nurture', projectId: proj, name: 'Blocked run', inputs: { qualify: { requirement: 'fasteners', businesses: biz } } })).json.instance.id;
  await t.request('POST', `/api/workflows/instances/${wf}/run`, u.token);
  const waitStage = async (stage, wantError) => { for (let i = 0; i < 40; i++) { const p = (await t.request('GET', `/api/workflows/instances/${wf}/pending-approval`, u.token)).json; if (p.pending && p.interrupt.stage_id === stage && (!wantError || p.interrupt.error)) return p.interrupt; await new Promise((x) => setTimeout(x, 1000)); } return null; };
  t.check('reached the qualify stage', !!(await waitStage('qualify')));
  await t.request('POST', `/api/workflows/instances/${wf}/resume`, u.token, { action: 'approve' });
  const paused = await waitStage('qualify', true);
  t.check('approving an AI stage while blocked re-pauses it with the budget message', !!paused && /budget/i.test(paused.error) && /block/i.test(paused.error));
  await page.goto(`${t.app}/workflows/${wf}`);
  await page.waitForSelector('.wf-stage-error:has-text("set to block AI requests")', { timeout: 15000 });
  t.check('the run page banner says the budget is blocking', true);

  // lift the block -> nothing blocks
  await t.request('PUT', '/api/usage/me/budget', u.token, { enforcement: 'alert' });
  const lifted = (await t.request('GET', `/api/usage/budget-status?project_id=${proj}`, u.token)).json;
  t.check('switching to alert lifts the block', lifted.blockedBy.length === 0);

  // per-stage cost
  t.seedUsage({ user: u.email, cost: 0.6, project: proj, workflow: wf, stage: 'qualify', agent: 'lead_scoring.score' });
  t.seedUsage({ user: u.email, cost: 0.15, project: proj, workflow: wf, stage: 'qualify', agent: 'lead_scoring.summarize' });
  t.seedUsage({ user: u.email, cost: 0.05, project: proj, workflow: wf, stage: 'personalize', agent: 'personalize.draft' });
  await page.reload(); await page.waitForSelector('.wf-stage-cost', { timeout: 15000 });
  const rows = (await page.locator('.wf-stage-cost').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim());
  t.check('stage rows show cost + request count', rows.includes('$0.75 · 2 AI requests') && rows.includes('$0.05 · 1 AI request'));
  await page.locator('.wf-stage-row:has(.wf-stage-cost:has-text("$0.75"))').click();
  await page.waitForSelector('.wf-cost-section');
  const sec = (await page.locator('.wf-cost-section').textContent()).replace(/\s+/g, ' ');
  t.check("the stage detail shows its total and share of the run", /\$0\.75 across 2 AI requests - 94% of this run's \$0\.80/.test(sec));
  t.check('the stage detail lists each call with its model', /lead_scoring\.score/.test(sec) && /lead_scoring\.summarize/.test(sec) && /gpt-4o-mini/.test(sec));

  // team budget (owner)
  await t.request('GET', '/api/team', u.token);
  await page.goto(`${t.app}/usage`); await page.waitForSelector('.usage-summary-cards');
  await Promise.all([page.waitForResponse((r) => /\/api\/team\/usage/.test(r.url())), page.locator('.module-tab:has-text("Team")').click()]);
  await page.waitForSelector('.usage-card-section:has-text("Team monthly budget")'); await page.waitForTimeout(400);
  await page.locator('#usage-budget-input').fill('4.00');
  await page.locator('.usage-budget-save').click();
  await page.waitForSelector('#usage-budget-block', { timeout: 8000 });
  await page.locator('#usage-budget-block').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ea-toast__msg')].some((n) => n.textContent.includes('blocked once')));
  const tb = (await t.request('GET', '/api/team/budget', u.token)).json;
  t.check('team budget saved as block; team spend covers the member', tb.monthlyBudgetUsd === 4 && tb.budget.enforcement === 'block' && Math.abs(tb.budget.spendUsd - 2.1) < 0.01);
  t.seedUsage({ user: u.email, cost: 2.0, project: proj });
  const teamBlocked = await paidRoute();
  t.check('over the team cap: 402 scope=team', teamBlocked.status === 402 && teamBlocked.json.scope === 'team');

  // project enforcement checkbox
  await t.request('PUT', `/api/projects/${proj}`, u.token, { monthlyBudgetUsd: 50 });
  await page.goto(`${t.app}/projects`); await page.waitForSelector('[title="AI provider settings"]');
  await page.locator('[title="AI provider settings"]').first().click();
  await page.waitForSelector('#project-budget-block');
  await page.locator('#project-budget-block').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ea-toast__msg')].some((n) => n.textContent.includes('blocked once')));
  const pj = (await t.request('GET', '/api/projects', u.token)).json.projects.find((p) => p.id === proj);
  t.check('project enforcement saved as block', pj.budgetEnforcement === 'block');
  t.onCleanup(async () => { await t.request('DELETE', `/api/workflows/instances/${wf}`, u.token); await t.request('DELETE', `/api/projects/${proj}`, u.token); });
};
