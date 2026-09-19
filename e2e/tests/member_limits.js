// A team owner caps a member; the member sees it locked; blocks reach them;
// $0 budgets; a request bigger than what is left is refused up front.
// Uses $0 / tiny caps instead of seeded spend, so it runs on dev and prod.
exports.title = 'Member caps, locks, $0 budgets, near-cap refusal';

exports.run = async (t) => {
  const owner = await t.newUser('owner'), member = await t.newUser('member'), solo = await t.newUser('solo');
  const op = await t.page(owner), mp = await t.page(member, { width: 1440, height: 900 });
  const team = (await t.request('GET', '/api/team', owner.token)).json.team_id;
  const memberId = `m-${Date.now()}`;
  // No invite flow that doesn't send real email: insert the membership directly.
  t.db(`INSERT INTO team_members (member_id, team_id, user_id, name, role, joined_at) VALUES ('${memberId}', '${team}', '${member.email}', 'Mia Member', 'member', now())`);
  const routeTask = (u) => t.request('POST', '/api/route-task', u.token, { task: 'find me suppliers of steel bolts' });   // refused before any provider when blocked

  // owner caps the member from the Team tab
  await op.goto(`${t.app}/usage`); await op.waitForSelector('.usage-summary-cards');
  await Promise.all([op.waitForResponse((r) => /\/api\/team\/members\/budgets/.test(r.url())), op.locator('.module-tab:has-text("Team")').click()]);
  await op.waitForSelector('.usage-member-table');
  const rows = (await op.locator('.usage-member-table tbody tr').allTextContents()).map((x) => x.replace(/\s+/g, ' '));
  t.check("the table lists the owner and the member; the owner's row has no cap controls", rows.length === 2 && /The owner sets their own/.test(rows.find((x) => x.includes(owner.email))));
  await op.locator(`#member-budget-${memberId}`).fill('0');
  await op.locator('.usage-member-table tr:has-text("Mia Member") .usage-budget-save').click();
  await op.waitForSelector(`.usage-member-table tr:has-text("Mia Member"):has-text("Set by ${owner.email}")`);
  await op.locator(`#member-budget-${memberId}-block`).click();
  await op.waitForFunction(() => [...document.querySelectorAll('.ea-toast__msg')].some((n) => /blocked once the cap/.test(n.textContent)));
  let mb = (await t.request('GET', '/api/usage/me/budget', member.token)).json.budget;
  t.check('the member has a locked $0 blocking cap set by the owner', mb.managedBy === owner.email && mb.enforcement === 'block' && mb.state === 'over' && mb.blocking === true);

  // member sees it locked and cannot lift it
  await mp.goto(`${t.app}/usage`); await mp.waitForSelector('.usage-budget-amounts');
  const card = (await mp.locator('.usage-card-section:has-text("My monthly budget")').textContent()).replace(/\s+/g, ' ');
  t.check('the member sees "Set by <owner> ... only they can change it"', card.includes(`Set by ${owner.email}`) && /only they can change it/.test(card));
  t.check('the member has no budget input or toggle', (await mp.locator('#usage-budget-input').count()) === 0 && (await mp.locator('#usage-budget-block').count()) === 0);
  t.check('lifting it via the API is 403', (await t.request('PUT', '/api/usage/me/budget', member.token, { monthlyBudgetUsd: 999 })).status === 403);

  // the cap blocks, the reason reaches them
  const blocked = await routeTask(member);
  t.check('the member request is refused with 402 (nothing reached a provider)', blocked.status === 402 && blocked.json.scope === 'user' && /\$0\.00/.test(blocked.json.error));
  t.check('X-Budget-Blocked is exposed to the browser', !!blocked.headers['x-budget-blocked'] && blocked.headers['x-budget-blocked-scope'] === 'user');
  await mp.evaluate(async (api) => { await fetch(`${api}/api/route-task`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('sessionToken')}` }, body: JSON.stringify({ task: 'x' }) }); }, t.api);
  await mp.waitForSelector('.ea-toast--warning:has-text("monthly AI budget")', { timeout: 8000 });
  t.check('the member sees a toast with the reason', true);
  await mp.evaluate(() => document.querySelectorAll('.ea-toast__close').forEach((b) => b.click()));
  await mp.waitForTimeout(600);
  await mp.route('**/api/pretend-degraded', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Budget-Blocked', 'X-Budget-Blocked': encodeURIComponent('Header-only degrade: the team budget "Acme" is blocking.') }, body: '{"results":[]}' }));
  await mp.evaluate((api) => fetch(`${api}/api/pretend-degraded`), t.api);
  await mp.waitForSelector('.ea-toast--warning:has-text("Header-only degrade")', { timeout: 5000 });
  t.check('a 200 response carrying X-Budget-Blocked still produces a toast', true);

  // permissions
  t.check('a plain member cannot list or set member budgets', (await t.request('GET', '/api/team/members/budgets', member.token)).status === 403 && (await t.request('PUT', '/api/team/members/x/budget', member.token, { monthlyBudgetUsd: 1 })).status === 403);
  const ownerRow = (await t.request('GET', '/api/team/members/budgets', owner.token)).json.members.find((m) => m.role === 'owner');
  t.check('nobody can cap the owner or themselves', (await t.request('PUT', `/api/team/members/${ownerRow.memberId}/budget`, owner.token, { monthlyBudgetUsd: 1 })).status === 400);

  // owner removes the cap from the UI; the member is free again
  await op.reload(); await op.waitForSelector('.usage-summary-cards');
  await Promise.all([op.waitForResponse((r) => /\/api\/team\/members\/budgets/.test(r.url())), op.locator('.module-tab:has-text("Team")').click()]);
  await op.locator('.usage-member-table tr:has-text("Mia Member") .usage-member-remove').click();
  await op.waitForFunction(() => [...document.querySelectorAll('.ea-toast__msg')].some((n) => /Cap removed/.test(n.textContent)));
  const own = await t.request('PUT', '/api/usage/me/budget', member.token, { monthlyBudgetUsd: 25 });
  t.check('after removal the member can set their own budget', own.status === 200 && own.json.budget.managedBy === null);

  // $0 budget
  await t.request('PUT', '/api/usage/me/budget', solo.token, { monthlyBudgetUsd: 0, enforcement: 'block' });
  const st0 = (await t.request('GET', '/api/usage/me/budget', solo.token)).json.budget;
  t.check('a $0 budget is "over" and blocking with no spend', st0.state === 'over' && st0.blocking === true);
  const zero = await routeTask(solo);
  t.check('a $0 block budget refuses the request', zero.status === 402 && /\$0\.00/.test(zero.json.error));

  // a request bigger than what is left is refused up front
  await t.request('PUT', '/api/usage/me/budget', solo.token, { monthlyBudgetUsd: 0.0001, enforcement: 'block' });
  const near = await routeTask(solo);
  t.log('near-cap message:', (near.json.error || '').slice(0, 160));
  t.check('a request larger than what is left is refused as "not enough", not let through', near.status === 402 && /not enough for this request/.test(near.json.error));
};
