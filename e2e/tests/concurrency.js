// REAL simultaneous AI requests against a budget with room for only two in
// flight: the reservations must let at most two run and refuse the rest up
// front, then leave nothing reserved. Spends about two real (cheap) AI calls.
exports.title = 'Budget reservations under real concurrency';

exports.run = async (t) => {
  const u = await t.newUser('conc');
  const call = () => t.request('POST', '/api/route-task', u.token, { task: 'find me suppliers of steel bolts' });

  await t.request('PUT', '/api/usage/me/budget', u.token, { monthlyBudgetUsd: 0.0001, enforcement: 'block' });
  const probe = await call();
  const est = parseFloat((probe.json.error || '').match(/about \$([0-9.]+)/)?.[1]);
  t.check('a probe is refused up front and the message states the estimate', probe.status === 402 && est > 0);
  const limit = +(est * 2.5).toFixed(4);
  await t.request('PUT', '/api/usage/me/budget', u.token, { monthlyBudgetUsd: limit, enforcement: 'block' });
  t.log(`one request ~ $${est}; budget $${limit} (room for 2 in flight)`);

  const results = await Promise.all(Array.from({ length: 6 }, call));
  const ran = results.filter((r) => r.status !== 402), refused = results.filter((r) => r.status === 402);
  t.log(`ran ${ran.length} (${ran.map((r) => r.status)}), refused ${refused.length}`);
  t.check('at most 2 of 6 simultaneous requests were let through', ran.length >= 1 && ran.length <= 2);
  t.check('the rest were refused up front with budget_exceeded', refused.length === 6 - ran.length && refused.every((r) => r.json.code === 'budget_exceeded'));
  t.check('a refusal says requests are still running', refused.some((r) => /still running/.test(r.json.error)));

  const usage = (await t.request('GET', '/api/usage/me?days=1', u.token)).json.usage;
  t.check(`the usage log holds exactly the ${ran.length} real request(s), with a real cost`, usage.requestCount === ran.length && usage.totalCostUsd > 0);
  t.check('no reservation is left behind', t.db(`select count(*) from budget_reservations where scope='user' and scope_id='${u.email}'`) === '0');
  const st = (await t.request('GET', '/api/usage/me/budget', u.token)).json.budget;
  t.check('the budget now reflects only real spend', st.spendUsd > 0 && st.spendUsd < limit && st.blocking === false);
};
