const fs = require('node:fs');
const path = require('node:path');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
module.exports = class DetoxJUnit {
  onRunComplete(_contexts, result) {
    const dir = path.resolve('artifacts/detox'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'jest-result.json'), JSON.stringify(result, null, 2));
    const cases = result.testResults.flatMap(suite => suite.testResults.map(test => {
      const details = test.status === 'passed' ? '' : test.status === 'pending' || test.status === 'todo' ? '<skipped />' :
        `<failure>${escape(test.failureMessages.join('\n'))}</failure>`;
      return `<testcase classname="${escape(test.ancestorTitles.join('.'))}" name="${escape(test.title)}" time="${(test.duration || 0) / 1000}">${details}</testcase>`;
    }));
    const runtime = result.testResults.filter(suite => suite.testExecError).map(suite =>
      `<testcase name="suite initialization"><error>${escape(suite.failureMessage || 'Detox initialization failed')}</error></testcase>`);
    fs.writeFileSync(path.join(dir, 'junit.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Detox native" tests="${cases.length + runtime.length}" failures="${result.numFailedTests}" errors="${runtime.length}" skipped="${result.numPendingTests + result.numTodoTests}">${cases.join('')}${runtime.join('')}</testsuite>\n`);
  }
};
