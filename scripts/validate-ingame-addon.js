import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import net from 'net';
import WebSocket from 'ws';

import { ensureIngameAddonInstalled } from '../build/core/ingame-addon.js';

const godotPath = process.argv[2] || process.env.GODOT_PATH;
if (!godotPath) {
  console.error('Usage: node scripts/validate-ingame-addon.js <godot-executable>');
  process.exit(2);
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function waitForOutput(child, marker, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for '${marker}'.\n${output}`)), timeoutMs);
    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
      if (output.includes(marker)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Godot exited before addon startup, code=${code}.\n${output}`));
    });
  });
}

async function openWebSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function createRpcClient(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Godot did not exit within 5 seconds after termination.')),
      5_000,
    )),
  ]);
}

const projectPath = mkdtempSync(join(tmpdir(), 'godot-mcp-ingame-runtime-'));
let child;
let socket;
try {
  const port = await reservePort();
  writeFileSync(join(projectPath, 'project.godot'), [
    '[application]',
    'config/name="GodotMCPAddonRuntime"',
    'run/main_scene="res://main.tscn"',
    '',
    '[godot_mcp]',
    `ingame/port=${port}`,
    '',
    '[rendering]',
    'renderer/rendering_method="gl_compatibility"',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(projectPath, 'main.tscn'), [
    '[gd_scene load_steps=2 format=3]',
    '',
    '[ext_resource path="res://main.gd" type="Script" id="1"]',
    '',
    '[node name="Main" type="Node"]',
    'script = ExtResource("1")',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(projectPath, 'main.gd'), [
    'extends Node',
    '',
    'class FixtureAdapter:',
    '\textends RefCounted',
    '',
    '\tfunc list_actions(_context: Dictionary) -> Dictionary:',
    '\t\treturn {"revision": "fixture-1", "actions": [{"id": "wave", "label": "挥手"}]}',
    '',
    '\tfunc run_action(action_id: String, arguments: Dictionary) -> Variant:',
    '\t\treturn {"ok": true, "action_id": action_id, "arguments": arguments}',
    '',
    'var adapter := FixtureAdapter.new()',
    '',
    'func _ready() -> void:',
    '\tGodotMCPIngame.set_action_adapter(adapter)',
    '',
  ].join('\n'), 'utf8');

  ensureIngameAddonInstalled(projectPath);
  child = spawn(godotPath, ['--headless', '--path', projectPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  await waitForOutput(child, `[GodotMCPIngame] 已监听 127.0.0.1:${port}`);

  socket = await openWebSocket(`ws://127.0.0.1:${port}`);
  const rpc = createRpcClient(socket);
  await rpc('initialize', {});
  const listed = await rpc('tools/list', {});
  const names = listed.tools.map(tool => tool.name);
  if (!names.includes('godot_mcp_actions_list') || !names.includes('godot_mcp_actions_run')) {
    throw new Error(`Generic actions tools are missing: ${JSON.stringify(names)}`);
  }

  const listResult = await rpc('tools/call', {
    name: 'godot_mcp_actions_list',
    arguments: { context: {} },
  });
  const listPayload = JSON.parse(listResult.content[0].text);
  if (listPayload.revision !== 'fixture-1' || listPayload.actions[0]?.id !== 'wave') {
    throw new Error(`Unexpected actions list payload: ${JSON.stringify(listPayload)}`);
  }

  const runResult = await rpc('tools/call', {
    name: 'godot_mcp_actions_run',
    arguments: { action_id: 'wave', arguments: { intensity: 2 } },
  });
  const runPayload = JSON.parse(runResult.content[0].text);
  if (!runPayload.ok || runPayload.action_id !== 'wave' || runPayload.arguments?.intensity !== 2) {
    throw new Error(`Unexpected action result: ${JSON.stringify(runPayload)}`);
  }
  console.log('Godot MCP ingame addon end-to-end validation passed.');
} finally {
  if (socket) socket.terminate();
  await stopChild(child);
  rmSync(projectPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
