import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { copilotHome, removeLegacyHook, removeLegacyState } from '../legacy';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'canary-legacy-'));

function hookFile(copilotDir: string, content: string): string {
	fs.mkdirSync(path.join(copilotDir, 'hooks'), { recursive: true });
	const file = path.join(copilotDir, 'hooks', 'canary.json');
	fs.writeFileSync(file, content);
	return file;
}

test('the hook file written by the earlier version is removed', () => {
	const dir = tempDir();
	const file = hookFile(dir, '{"hooks":{"agentStop":[{"bash":"\\"Code.exe\\" \\"c:\\\\Users\\\\x\\\\.vscode\\\\extensions\\\\Fwedpat.context-canary-0.0.1\\\\out\\\\hook.js\\""}]}}');
	assert.equal(removeLegacyHook(dir), true);
	assert.equal(fs.existsSync(file), false);
	assert.equal(removeLegacyHook(dir), false, 'a second run finds nothing');
});

test('a hook file that is not ours is never touched', () => {
	const dir = tempDir();
	const file = hookFile(dir, '{"hooks":{"sessionStart":[{"bash":"./my-own-canary-script.sh"}]}}');
	assert.equal(removeLegacyHook(dir), false);
	assert.equal(fs.existsSync(file), true);
	assert.equal(removeLegacyHook(path.join(dir, 'missing')), false);
});

test('only Canary\'s own leftover state files are removed', () => {
	const dir = tempDir();
	fs.mkdirSync(path.join(dir, 'sessions'));
	fs.writeFileSync(path.join(dir, 'sessions', 'a.json'), '{}');
	fs.writeFileSync(path.join(dir, 'config.json'), '{}');
	fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
	removeLegacyState(dir);
	assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
	removeLegacyState(path.join(dir, 'missing'));
});

test('COPILOT_HOME overrides the default location', () => {
	assert.equal(copilotHome({ COPILOT_HOME: '/custom' }, '/home/x'), '/custom');
	assert.equal(copilotHome({}, '/home/x'), path.join('/home/x', '.copilot'));
});
