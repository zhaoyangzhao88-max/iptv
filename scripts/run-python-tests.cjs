const { spawnSync } = require('node:child_process');

const root = process.cwd();
const pythonArgs = ['-m', 'pytest'];

function run(command, args) {
  return spawnSync(command, args, {
    cwd: root + '/iptv-engine-b',
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
}

let result = run('python', pythonArgs);
if (result.status === 0) {
  process.exit(0);
}

const uvArgs = [
  'run',
  '--no-project',
  '--python',
  '3.11',
  '--with', 'pytest',
  '--with', 'pytest-asyncio',
  '--with', 'aiohttp',
  '--with', 'pydantic',
  '--with', 'requests',
  '--',
  'python',
  ...pythonArgs,
];
const fallback = run('uv', uvArgs);
process.exit(fallback.status === null ? (result.status ?? 1) : fallback.status);
