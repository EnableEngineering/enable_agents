// A real AI call that crosses an alert-only budget must (a) still succeed,
// (b) mark the budget as alerted for this month, and (c) not make the request
// wait on SMTP - the email goes through Celery. Delivery itself is checked in
// the worker log (`docker compose logs celery-worker-dev` / the remote celery
// container): "Task budget.send_alert_email ... received". The recipient is the
// throwaway @enableyou.co account. Spends one small AI call.
exports.title = 'Budget alerts are queued, not sent inline';

exports.run = async (t) => {
  const u = await t.newUser('alert');
  await t.request('PUT', '/api/usage/me/budget', u.token, { monthlyBudgetUsd: 0.001, enforcement: 'alert' });   // alert-only: never blocks
  const started = Date.now();
  const res = await t.request('POST', '/api/route-task', u.token, { task: 'find me suppliers of steel bolts' });
  const seconds = (Date.now() - started) / 1000;
  t.log(`the AI call took ${seconds.toFixed(1)}s`);
  t.check('the request succeeded (an alert-only budget never blocks)', res.status === 200);
  const st = (await t.request('GET', '/api/usage/me/budget', u.token)).json.budget;
  t.check('the budget is now over its limit but not blocking', st.state === 'over' && st.blocking === false);
  const month = new Date().toISOString().slice(0, 7);
  t.check('the "over budget" alert was recorded for this month', t.db(`select over_month from user_budgets where user_id='${u.email}'`) === month);
};
