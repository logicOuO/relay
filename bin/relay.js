#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = process.env.RELAY_HOME || os.homedir();
const claudeDir = path.join(home, '.claude');
const skillDir = path.join(claudeDir, 'skills', 'relay');
const sourceDir = path.join(__dirname, '..', 'skill');
const settingsFile = path.join(claudeDir, 'settings.json');
const claudeFile = path.join(claudeDir, 'CLAUDE.md');
const codexDir = path.join(home, '.codex');
const codexSkillDir = path.join(codexDir, 'skills', 'relay');
const codexFile = path.join(codexDir, 'config.toml');
const manifestFile = path.join(skillDir, '.install.json');
const hookFragment = 'skills/relay/scripts/check-clean-tree.sh';
const flag = 'default_mode_request_user_input';
const begin = '<!-- relay:begin -->';
const end = '<!-- relay:end -->';
const instructionMarker = "relay segment in the project's AGENTS.md";
const instruction = '- Code-changing tasks follow the relay segment in the project\'s AGENTS.md; if the project has none, start with the `relay` skill. Its confirmation gate overrides any "assume instead of asking" rule; trivial changes are exempt.';
const usage = '用法：relay install [--no-hook] [--no-claude-md] [--no-codex]\n      relay uninstall\n      relay status\n      relay --help\n';

function readText(file) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  return { text: raw.slice(bom.length), bom, eol: raw.includes('\r\n') ? '\r\n' : '\n' };
}

function writeText(file, text, format) {
  const content = format.bom + text;
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') === content) return;
    fs.copyFileSync(file, file + '.relay-backup');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function readSettings() {
  const format = readText(settingsFile);
  let data;
  try {
    data = fs.existsSync(settingsFile) ? JSON.parse(format.text) : {};
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.error(`✗ 无效 JSON：${settingsFile}`);
    process.exitCode = 1;
    return null;
  }
  return { data, format };
}

function writeSettings(settings) {
  writeText(settingsFile, JSON.stringify(settings.data, null, 2).replace(/\n/g, settings.format.eol) + settings.format.eol, settings.format);
}

function isRelayHook(entry) {
  return Boolean(entry.command?.includes(hookFragment) || entry.hooks?.some(hook => hook.command?.includes(hookFragment)));
}

function sameSkill(source, target, root = true) {
  if (!fs.existsSync(target)) return false;
  const sourceEntries = fs.readdirSync(source, { withFileTypes: true });
  const targetNames = fs.readdirSync(target).filter(name => !root || name !== '.install.json');
  if (sourceEntries.length !== targetNames.length) return false;
  return sourceEntries.every(entry => {
    if (!targetNames.includes(entry.name)) return false;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory() !== fs.statSync(targetPath).isDirectory()) return false;
    return entry.isDirectory() ? sameSkill(sourcePath, targetPath, false) : fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath));
  });
}

function already(name) {
  console.log(`= ${name} 已存在（already），跳过`);
}

function install(options) {
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { hook: false, claudeMd: false, codex: false };
  if (sameSkill(sourceDir, skillDir)) {
    already('skill');
  } else {
    fs.rmSync(skillDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(skillDir), { recursive: true });
    fs.cpSync(sourceDir, skillDir, { recursive: true });
    console.log('✓ skill 已安装');
  }

  if (options.includes('--no-codex')) {
    console.log('= codex-skill 已跳过');
  } else if (!fs.existsSync(codexDir)) {
    console.log('= codex-skill 目录不存在，跳过');
  } else if (sameSkill(sourceDir, codexSkillDir, false)) {
    already('codex-skill');
  } else {
    fs.rmSync(codexSkillDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(codexSkillDir), { recursive: true });
    fs.cpSync(sourceDir, codexSkillDir, { recursive: true });
    console.log('✓ codex-skill 已安装');
  }

  if (options.includes('--no-hook')) {
    console.log('= hook 已跳过');
  } else {
    const settings = readSettings();
    if (settings) {
      const legacyHook = settings.data.hooks?.UserPromptSubmit?.some(isRelayHook);
      if (!legacyHook && settings.data.hooks?.SessionStart?.some(isRelayHook)) {
        already('hook');
      } else {
        settings.data.hooks ??= {};
        if (legacyHook) {
          settings.data.hooks.UserPromptSubmit = settings.data.hooks.UserPromptSubmit.filter(entry => !isRelayHook(entry));
          if (!settings.data.hooks.UserPromptSubmit.length) delete settings.data.hooks.UserPromptSubmit;
        }
        settings.data.hooks.SessionStart = (settings.data.hooks.SessionStart || []).filter(entry => !isRelayHook(entry));
        settings.data.hooks.SessionStart.push({ hooks: [{ type: 'command', shell: 'bash', timeout: 10, command: 'bash "$HOME/.claude/skills/relay/scripts/check-clean-tree.sh"' }] });
        writeSettings(settings);
        manifest.hook = true;
        console.log('✓ hook 已安装');
      }
    }
  }

  if (options.includes('--no-claude-md')) {
    console.log('= claude-md 已跳过');
  } else {
    const format = readText(claudeFile);
    const block = [begin, instruction, end].join(format.eol);
    const markedBlock = /<!-- relay:begin -->[\s\S]*?<!-- relay:end -->/g;
    const oldLine = /^(?![^\r\n]*relay segment in the project's AGENTS\.md)[^\r\n]*start with the `relay` skill[^\r\n]*/gm;
    let text = format.text;
    if (markedBlock.test(text)) {
      text = text.replace(markedBlock, () => block);
    } else if (oldLine.test(text)) {
      text = text.replace(oldLine, () => block);
    } else if (!text.includes(instructionMarker)) {
      const separator = text && !text.endsWith('\n') ? format.eol : '';
      text += separator + block + format.eol;
    }
    if (text === format.text) {
      already('claude-md');
    } else {
      writeText(claudeFile, text, format);
      manifest.claudeMd = true;
      console.log('✓ claude-md 已安装');
    }
  }

  if (options.includes('--no-codex')) {
    console.log('= codex 已跳过');
  } else if (!fs.existsSync(codexDir)) {
    console.log('= codex 目录不存在，跳过');
  } else {
    const format = readText(codexFile);
    if (/^\s*default_mode_request_user_input\s*=/m.test(format.text)) {
      already('codex');
    } else {
      const header = /^[^\S\r\n]*\[features\][^\S\r\n]*(?:#[^\r\n]*)?(?:\r?\n|$)/m;
      const setting = `${flag} = true${format.eol}`;
      const text = header.test(format.text)
        ? format.text.replace(header, line => line + (line.endsWith('\n') ? '' : format.eol) + setting)
        : format.text + format.eol + '[features]' + format.eol + setting;
      writeText(codexFile, text, format);
      manifest.codex = true;
      console.log('✓ codex 已安装');
    }
  }

  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  if (!fs.existsSync(manifestFile) || fs.readFileSync(manifestFile, 'utf8') !== manifestText) {
    fs.writeFileSync(manifestFile, manifestText, 'utf8');
  }
  console.log('请重启 Claude Code。');
}

function uninstall() {
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { codex: false };
  if (fs.existsSync(settingsFile)) {
    const settings = readSettings();
    if (settings && ['SessionStart', 'UserPromptSubmit'].some(event => settings.data.hooks?.[event]?.some(isRelayHook))) {
      const hooks = settings.data.hooks;
      for (const event of ['SessionStart', 'UserPromptSubmit']) {
        if (!hooks[event]) continue;
        hooks[event] = hooks[event].filter(entry => !isRelayHook(entry));
        if (!hooks[event].length) delete hooks[event];
      }
      if (!Object.keys(hooks).length) delete settings.data.hooks;
      writeSettings(settings);
    }
  }
  console.log('✓ hook 已移除');

  if (fs.existsSync(claudeFile)) {
    const format = readText(claudeFile);
    let text = format.text.replace(/^[^\S\r\n]*<!-- relay:begin -->[^\r\n]*\r?\n[\s\S]*?<!-- relay:end -->[^\r\n]*(?:\r?\n|$)/gm, '');
    // The install backup identifies a separator added to an unterminated file.
    if (text !== format.text && fs.existsSync(claudeFile + '.relay-backup')) {
      const original = readText(claudeFile + '.relay-backup');
      if (text === original.text + format.eol) text = original.text;
    }
    if (text !== format.text) writeText(claudeFile, text, format);
  }
  console.log('✓ claude-md 已移除');

  if (manifest.codex && fs.existsSync(codexFile)) {
    const format = readText(codexFile);
    const text = format.text.replace(/^[^\S\r\n]*default_mode_request_user_input[^\S\r\n]*=[^\S\r\n]*true[^\S\r\n]*(?:#[^\r\n]*)?(?:\r?\n|$)/gm, '');
    if (text !== format.text) writeText(codexFile, text, format);
  }
  console.log('✓ codex 已处理');
  fs.rmSync(skillDir, { recursive: true, force: true });
  console.log('✓ skill 已移除');
  fs.rmSync(codexSkillDir, { recursive: true, force: true });
  console.log('✓ codex-skill 已移除');
}

function status() {
  const settings = fs.existsSync(settingsFile) ? readSettings() : null;
  const states = {
    skill: fs.existsSync(skillDir),
    'codex-skill': fs.existsSync(path.join(codexSkillDir, 'SKILL.md')),
    hook: Boolean(settings?.data.hooks?.SessionStart?.some(isRelayHook)),
    'claude-md': readText(claudeFile).text.includes(instructionMarker),
    codex: /^\s*default_mode_request_user_input\s*=\s*true\s*(?:#.*)?$/m.test(readText(codexFile).text)
  };
  for (const [name, installed] of Object.entries(states)) {
    console.log(`${name}: ${installed ? 'installed' : 'not installed'}`);
  }
}

const [command, ...options] = process.argv.slice(2);
const validInstallFlags = ['--no-hook', '--no-claude-md', '--no-codex'];
if (command === 'install' && options.every(option => validInstallFlags.includes(option))) {
  install(options);
} else if (command === 'uninstall' && !options.length) {
  uninstall();
} else if (command === 'status' && !options.length) {
  status();
} else if (command === '--help' && !options.length) {
  process.stdout.write(usage);
} else {
  process.stderr.write(usage);
  process.exitCode = 2;
}
