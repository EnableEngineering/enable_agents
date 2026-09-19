// node e2e/run.js [suite ...]      (TARGET=dev|prod; default: every suite that can run on TARGET)
const fs = require('fs');
const path = require('path');
const { newSuite, TARGET } = require('./lib');

(async () => {
  const dir = path.join(__dirname, 'tests');
  const wanted = process.argv.slice(2);
  const suites = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => ({ file: f, mod: require(path.join(dir, f)) }))
    .filter(({ file }) => !wanted.length || wanted.includes(file.replace(/\.js$/, '')));
  let failed = 0, ran = 0;
  for (const { file, mod } of suites) {
    if (mod.devOnly && TARGET === 'prod') { console.log(`\n== ${mod.title} - skipped on prod (${mod.devOnly})`); continue; }
    console.log(`\n== ${mod.title}  [${TARGET}]`);
    const ctx = await newSuite(file);
    let failures = [];
    try { await mod.run(ctx); } catch (e) { console.log(`  ERROR: ${e.stack || e}`); failures.push(`crashed: ${e.message}`); }
    failures = failures.concat(await ctx.finish());
    ran++; failed += failures.length;
  }
  console.log(failed ? `\n${failed} FAILED across ${ran} suite(s)` : `\nALL ${ran} SUITE(S) PASSED`);
  process.exit(failed ? 1 : 0);
})();
