'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'bin', 'relay.js');
const source = path.join(__dirname, '..', 'skill');
const fragment = 'skills/relay/scripts/check-clean-tree.sh';
const key = 'default_mode_request_user_input';
const relayHook = { hooks: [{ type: 'command', shell: 'bash', timeout: 10, command: 'bash "$HOME/.claude/skills/relay/scripts/check-clean-tree.sh"' }] };
const block = '<!-- relay:begin -->\n- Code-changing tasks start with the `relay` skill (align in plain language → user confirms → implement → verify tests and each requirement). Its confirmation gate overrides any "assume instead of asking" rule; trivial changes are exempt.\n<!-- relay:end -->\n';

function fixture(t, codex = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  if (codex) fs.mkdirSync(path.join(home, '.codex'));
  const file = relative => path.join(home, relative);
  return {
    home,
    file,
    run: (...args) => execFileSync(process.execPath, [cli, ...args], {
      env: { ...process.env, RELAY_HOME: home }, encoding: 'utf8', stdio: 'pipe'
    }),
    write(relative, content) {
      fs.mkdirSync(path.dirname(file(relative)), { recursive: true });
      fs.writeFileSync(file(relative), content);
    },
    read: relative => fs.readFileSync(file(relative), 'utf8'),
    exists: relative => fs.existsSync(file(relative))
  };
}

function snapshot(dir) {
  const result = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    result[entry.name] = entry.isDirectory() ? snapshot(full) : fs.readFileSync(full);
  }
  return result;
}

test('install on an empty home copies the whole skill and installs the exact hook and instruction', t => {
  const f = fixture(t);
  assert.match(f.run('install'), /重启 Claude Code/);
  const skill = snapshot(f.file('.claude/skills/relay'));
  delete skill['.install.json'];
  assert.deepEqual(skill, snapshot(source));
  assert.deepEqual(JSON.parse(f.read('.claude/settings.json')), { hooks: { UserPromptSubmit: [relayHook] } });
  assert.equal(f.read('.claude/settings.json'), JSON.stringify({ hooks: { UserPromptSubmit: [relayHook] } }, null, 2) + '\n');
  assert.equal(f.read('.claude/CLAUDE.md'), block);
  assert.deepEqual(JSON.parse(f.read('.claude/skills/relay/.install.json')), { hook: true, claudeMd: true, codex: false });
});

test('a second install leaves all files and backups identical and retains manifest ownership', t => {
  const f = fixture(t, true);
  f.write('.claude/settings.json', '{"theme":"dark"}\n');
  f.write('.claude/CLAUDE.md', 'Existing instructions');
  f.write('.codex/config.toml', 'model = "example"\n');
  f.run('install');
  const before = snapshot(f.home);
  assert.match(f.run('install'), /already/);
  assert.deepEqual(snapshot(f.home), before);
  assert.deepEqual(JSON.parse(f.read('.claude/skills/relay/.install.json')), { hook: true, claudeMd: true, codex: true });
  f.run('install', '--no-hook', '--no-claude-md', '--no-codex');
  assert.deepEqual(snapshot(f.home), before);
});

test('install replaces stale skill contents fully while preserving the previous manifest', t => {
  const f = fixture(t, true);
  f.run('install');
  f.write('.claude/skills/relay/stale/nested.txt', 'obsolete');
  f.write('.claude/skills/relay/SKILL.md', 'outdated');
  f.run('install');
  const skill = snapshot(f.file('.claude/skills/relay'));
  const manifest = JSON.parse(skill['.install.json'].toString());
  delete skill['.install.json'];
  assert.deepEqual(skill, snapshot(source));
  assert.deepEqual(manifest, { hook: true, claudeMd: true, codex: true });
});

test('settings preserve unrelated keys and hooks; uninstall restores their content', t => {
  const f = fixture(t);
  const other = { hooks: [{ type: 'command', command: 'echo other' }] };
  const original = { theme: 'dark', permissions: { allow: ['Read'] }, hooks: { UserPromptSubmit: [other], Stop: [other] } };
  const text = JSON.stringify(original, null, 2) + '\n';
  f.write('.claude/settings.json', text);
  f.run('install');
  assert.deepEqual(JSON.parse(f.read('.claude/settings.json')), {
    ...original, hooks: { ...original.hooks, UserPromptSubmit: [other, relayHook] }
  });
  assert.equal(f.read('.claude/settings.json.relay-backup'), text);
  const installed = f.read('.claude/settings.json');
  f.run('uninstall');
  assert.deepEqual(JSON.parse(f.read('.claude/settings.json')), original);
  assert.equal(f.read('.claude/settings.json.relay-backup'), installed);
});

test('pre-existing relay hook and unmarked instruction are not duplicated or claimed', t => {
  const f = fixture(t);
  const hook = { hooks: [{ type: 'command', command: `custom ${fragment} --option` }] };
  const settings = JSON.stringify({ hooks: { UserPromptSubmit: [hook] } });
  const text = 'Custom tasks start with the `relay` skill, please.\n';
  f.write('.claude/settings.json', settings);
  f.write('.claude/CLAUDE.md', text);
  f.run('install');
  assert.equal(f.read('.claude/settings.json'), settings);
  assert.equal(f.read('.claude/CLAUDE.md'), text);
  assert.deepEqual(JSON.parse(f.read('.claude/skills/relay/.install.json')), { hook: false, claudeMd: false, codex: false });
  assert.equal(f.exists('.claude/settings.json.relay-backup'), false);
  f.run('uninstall');
  assert.deepEqual(JSON.parse(f.read('.claude/settings.json')), {});
  assert.equal(f.read('.claude/CLAUDE.md'), text);
});

for (const original of ['Instructions\n', 'Instructions', 'Instructions\r\n', '\uFEFFInstructions\r\n', '']) {
  test(`CLAUDE.md appends cleanly and restores original bytes: ${JSON.stringify(original)}`, t => {
    const f = fixture(t);
    f.write('.claude/CLAUDE.md', original);
    f.run('install');
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const separator = original && !original.endsWith('\n') ? eol : '';
    const installed = original + separator + block.replace(/\n/g, eol);
    assert.equal(f.read('.claude/CLAUDE.md'), installed);
    assert.equal(f.read('.claude/CLAUDE.md.relay-backup'), original);
    f.run('uninstall');
    assert.equal(f.read('.claude/CLAUDE.md'), original);
    assert.equal(f.read('.claude/CLAUDE.md.relay-backup'), installed);
  });
}

test('UTF-8 BOM and CRLF survive settings and Codex edits and their backups', t => {
  const f = fixture(t, true);
  const settings = '\uFEFF{\r\n  "theme": "dark"\r\n}\r\n';
  const config = '\uFEFF[features]\r\nother = true\r\n';
  f.write('.claude/settings.json', settings);
  f.write('.codex/config.toml', config);
  f.run('install');
  for (const name of ['.claude/settings.json', '.codex/config.toml']) {
    assert.ok(f.read(name).startsWith('\uFEFF'));
    assert.doesNotMatch(f.read(name), /(?<!\r)\n/);
  }
  assert.equal(f.read('.claude/settings.json.relay-backup'), settings);
  assert.equal(f.read('.codex/config.toml.relay-backup'), config);
  f.run('uninstall');
  assert.equal(f.read('.claude/settings.json'), settings);
  assert.equal(f.read('.codex/config.toml'), config);
});

test('Codex inserts immediately under an existing features table and retains the header on uninstall', t => {
  const f = fixture(t, true);
  const original = 'model = "example"\n[features]\nother = true\n[other]\nvalue = 1\n';
  f.write('.codex/config.toml', original);
  f.run('install');
  const installed = original.replace('[features]\n', `[features]\n${key} = true\n`);
  assert.equal(f.read('.codex/config.toml'), installed);
  assert.equal(f.read('.codex/config.toml.relay-backup'), original);
  f.run('uninstall');
  assert.equal(f.read('.codex/config.toml'), original);
  assert.equal(f.read('.codex/config.toml.relay-backup'), installed);
});

for (const original of [null, 'model = "example"', 'model = "example"\n']) {
  test(`Codex appends features when absent: ${JSON.stringify(original)}`, t => {
    const f = fixture(t, true);
    if (original !== null) f.write('.codex/config.toml', original);
    f.run('install');
    assert.equal(f.read('.codex/config.toml'), (original || '') + `\n[features]\n${key} = true\n`);
    assert.equal(f.exists('.codex/config.toml.relay-backup'), original !== null);
    f.run('uninstall');
    assert.equal(f.read('.codex/config.toml'), (original || '') + '\n[features]\n');
  });
}

test('Codex is skipped with a note when its directory does not exist', t => {
  const f = fixture(t);
  assert.match(f.run('install'), /codex.*跳过/);
  assert.equal(f.exists('.codex'), false);
  assert.equal(JSON.parse(f.read('.claude/skills/relay/.install.json')).codex, false);
});

for (const value of ['true', 'false']) {
  test(`a pre-existing Codex flag anywhere is left intact on install and uninstall: ${value}`, t => {
    const f = fixture(t, true);
    const original = `[other]\n  ${key} = ${value}\n`;
    f.write('.codex/config.toml', original);
    f.run('install');
    assert.equal(f.read('.codex/config.toml'), original);
    assert.equal(f.exists('.codex/config.toml.relay-backup'), false);
    assert.equal(JSON.parse(f.read('.claude/skills/relay/.install.json')).codex, false);
    f.run('uninstall');
    assert.equal(f.read('.codex/config.toml'), original);
  });
}

test('uninstall drops empty hook containers, removes only marked blocks, and is idempotent', t => {
  const f = fixture(t, true);
  f.write('project/AGENTS.md', 'Project rules\n');
  f.write('.claude/settings.json', '{"theme":"light"}');
  f.write('.claude/CLAUDE.md', 'Before\n');
  f.run('install');
  f.write('.claude/CLAUDE.md', f.read('.claude/CLAUDE.md') + 'After\n');
  f.run('uninstall');
  assert.deepEqual(JSON.parse(f.read('.claude/settings.json')), { theme: 'light' });
  assert.equal(f.read('.claude/CLAUDE.md'), 'Before\nAfter\n');
  assert.equal(f.exists('.claude/skills/relay'), false);
  assert.equal(f.read('project/AGENTS.md'), 'Project rules\n');
  const before = snapshot(f.home);
  f.run('uninstall');
  assert.deepEqual(snapshot(f.home), before);
});

test('uninstall on an empty home does not create files', t => {
  const f = fixture(t);
  f.run('uninstall');
  assert.deepEqual(snapshot(f.home), {});
});

test('invalid settings JSON is untouched, names the file, exits 1, and other install steps finish', t => {
  const f = fixture(t, true);
  const invalid = '\uFEFF{ broken JSON\r\n';
  f.write('.claude/settings.json', invalid);
  assert.throws(() => f.run('install'), error => {
    assert.equal(error.status, 1);
    assert.ok(error.stderr.includes(f.file('.claude/settings.json')));
    assert.match(error.stdout, /重启 Claude Code/);
    return true;
  });
  assert.equal(f.read('.claude/settings.json'), invalid);
  assert.equal(f.exists('.claude/settings.json.relay-backup'), false);
  assert.equal(f.read('.claude/CLAUDE.md'), block);
  assert.match(f.read('.codex/config.toml'), /default_mode_request_user_input = true/);
  assert.deepEqual(JSON.parse(f.read('.claude/skills/relay/.install.json')), { hook: false, claudeMd: true, codex: true });
});

for (const [option, skippedFile, manifestKey] of [
  ['--no-hook', '.claude/settings.json', 'hook'],
  ['--no-claude-md', '.claude/CLAUDE.md', 'claudeMd'],
  ['--no-codex', '.codex/config.toml', 'codex']
]) {
  test(`${option} skips only its corresponding step`, t => {
    const f = fixture(t, true);
    f.run('install', option);
    assert.equal(f.exists(skippedFile), false);
    const manifest = JSON.parse(f.read('.claude/skills/relay/.install.json'));
    assert.equal(manifest[manifestKey], false);
    for (const other of ['hook', 'claudeMd', 'codex'].filter(name => name !== manifestKey)) {
      assert.equal(manifest[other], true);
    }
  });
}

test('all skip flags together leave existing configuration bytes untouched', t => {
  const f = fixture(t, true);
  const originals = { '.claude/settings.json': '{ invalid', '.claude/CLAUDE.md': 'Keep me', '.codex/config.toml': 'model = "keep"' };
  for (const [name, text] of Object.entries(originals)) f.write(name, text);
  f.run('install', '--no-hook', '--no-claude-md', '--no-codex');
  for (const [name, text] of Object.entries(originals)) {
    assert.equal(f.read(name), text);
    assert.equal(f.exists(name + '.relay-backup'), false);
  }
  assert.deepEqual(JSON.parse(f.read('.claude/skills/relay/.install.json')), { hook: false, claudeMd: false, codex: false });
});

test('status reports four components without changing files', t => {
  const f = fixture(t, true);
  assert.equal(f.run('status'), 'skill: not installed\nhook: not installed\nclaude-md: not installed\ncodex: not installed\n');
  f.run('install');
  const before = snapshot(f.home);
  assert.equal(f.run('status'), 'skill: installed\nhook: installed\nclaude-md: installed\ncodex: installed\n');
  assert.deepEqual(snapshot(f.home), before);
  f.run('uninstall');
  assert.equal(f.run('status'), 'skill: not installed\nhook: not installed\nclaude-md: not installed\ncodex: not installed\n');
});

test('--help prints usage successfully without modifying the home', t => {
  const f = fixture(t);
  assert.match(f.run('--help'), /relay install.*--no-hook.*--no-claude-md.*--no-codex/);
  assert.deepEqual(snapshot(f.home), {});
});

for (const args of [[], ['unknown'], ['install', '--unknown'], ['install', 'extra'], ['status', '--no-hook'], ['uninstall', '--no-codex'], ['--help', '--unknown']]) {
  test(`invalid arguments print usage to stderr and exit 2: ${JSON.stringify(args)}`, t => {
    const f = fixture(t);
    assert.throws(() => f.run(...args), error => {
      assert.equal(error.status, 2);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /relay install/);
      assert.match(error.stderr, /relay uninstall/);
      assert.match(error.stderr, /relay status/);
      return true;
    });
    assert.deepEqual(snapshot(f.home), {});
  });
}
