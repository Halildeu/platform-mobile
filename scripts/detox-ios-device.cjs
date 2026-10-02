const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const all = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { encoding: 'utf8' }));
const candidates = Object.entries(all.devices).filter(([runtime]) => runtime.includes('.iOS-'))
  .sort(([a], [b]) => b.localeCompare(a, 'en', { numeric: true }))
  .flatMap(([runtime, devices]) => devices.filter(device => device.isAvailable && device.name.startsWith('iPhone')).map(device => ({ runtime, ...device })));
const selected = candidates[0];
if (!selected || !/^[a-f0-9-]{36}$/i.test(selected.udid)) throw new Error('No installed, available iPhone simulator');
fs.mkdirSync('artifacts/detox', { recursive: true });
fs.writeFileSync('artifacts/detox/ios-simulator.json', JSON.stringify(selected, null, 2));
if (!process.env.GITHUB_ENV) throw new Error('CI environment output is required');
fs.appendFileSync(process.env.GITHUB_ENV, `DETOX_IOS_UDID=${selected.udid}\n`);
