// Shared helpers for the browser/API end-to-end suite. See e2e/README.md.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');

const TARGET = process.env.TARGET || 'dev';           // dev | prod
const REPO = path.resolve(__dirname, '..');
const API = TARGET === 'prod' ? 'https://agents.enableyou.co' : 'http://localhost:5000';
const APP = TARGET === 'prod' ? 'https://agents.enableyou.co' : 'http://localhost:3000';
const PROD_INSTANCE = process.env.DEPLOY_INSTANCE || 'instance-20260419-210128';
const PROD_ZONE = process.env.DEPLOY_ZONE || 'us-east1-b';
const TEST_DOMAIN = '@enableyou.co';                  // the ONLY domain test accounts may use: nothing here may email anyone else

/** Run SQL against the target's database. Returns the first column of the first row (or 'ok'). */
function db(sqlText) {
  if (TARGET === 'prod') {
    const py = `import os, json\nfrom sqlalchemy import create_engine, text\ne = create_engine(os.environ["DATABASE_URI"])\n` +
      `with e.begin() as c:\n    r = c.execute(text(json.loads(${JSON.stringify(JSON.stringify(sqlText))})))\n    print("RESULT", r.scalar() if r.returns_rows else "ok")\n`;
    const out = execSync(`gcloud compute ssh ${PROD_INSTANCE} --zone=${PROD_ZONE} --command='sudo docker exec -i enable_agents_backend_remote python -'`, { input: py, timeout: 180000 }).toString();
    return out.match(/RESULT (.*)/)[1].trim();
  }
  return execSync(`docker compose exec -T postgres psql -U enable_agents -d enable_agents -At -c "${sqlText.replace(/"/g, '\\"')}"`, { cwd: REPO }).toString().trim();
}

/** Insert one usage-log row with a known cost (dev only: it writes straight to the database). */
function seedUsage({ user, cost, project = null, workflow = null, stage = null, agent = 'seed.agent' }) {
  if (TARGET === 'prod') throw new Error('seedUsage is dev-only');
  const q = (v) => (v ? `'${v}'` : 'NULL');
  db(`INSERT INTO ai_usage_log (user_id, project_id, agent, provider, model, key_source, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, workflow_instance_id, workflow_stage_id, created_at) VALUES ('${user}', ${q(project)}, '${agent}', 'openai', 'gpt-4o-mini', 'platform', 100, 50, 150, ${cost}, ${q(workflow)}, ${q(stage)}, now())`);
}

async function newSuite(name) {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const users = [];
  const cleanups = [];
  const ctx = {
    name, target: TARGET, api: API, app: APP, browser, db, seedUsage,
    check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${label}`); if (!ok) failures.push(label); },
    log: (...a) => console.log('   ', ...a),
    async request(method, route, token, body) {
      const res = await fetch(`${API}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text(); let json = {}; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
      return { status: res.status, json, headers: Object.fromEntries(res.headers.entries()) };
    },
    /** Register a throwaway account (always @enableyou.co) and remember it for cleanup. */
    async newUser(label) {
      const email = `e2e_${label}_${Date.now()}_${Math.floor(Math.random() * 1000)}${TEST_DOMAIN}`;
      const res = await ctx.request('POST', '/register', null, { email, password: 'TestPass123!', username: email });
      if (!res.json.session_token) throw new Error(`could not register ${email}: ${JSON.stringify(res.json)}`);
      const user = { email, token: res.json.session_token };
      users.push(user);
      return user;
    },
    /** A logged-in browser page for a user. */
    async page(user, viewport = { width: 1440, height: 1000 }) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(`${APP}/login`);
      await page.evaluate(({ token, email }) => {
        localStorage.setItem('sessionToken', token); localStorage.setItem('userEmail', email);
        localStorage.setItem('firstName', 'e2e'); localStorage.setItem('enableAgentsMode', 'live');
        sessionStorage.setItem('aiAssistantOpen', 'false');
      }, user);
      return page;
    },
    onCleanup(fn) { cleanups.push(fn); },
  };
  ctx.finish = async () => {
    for (const fn of cleanups.reverse()) { try { await fn(); } catch (e) { /* best effort */ } }
    for (const u of users) { try { await ctx.request('DELETE', '/api/account', u.token); } catch (e) { /* best effort */ } }
    if (TARGET === 'dev') for (const u of users) { try { db(`DELETE FROM ai_usage_log WHERE user_id='${u.email}'`); } catch (e) { /* best effort */ } }
    await browser.close();
    return failures;
  };
  return ctx;
}

module.exports = { newSuite, TARGET, API, APP, db, seedUsage };
