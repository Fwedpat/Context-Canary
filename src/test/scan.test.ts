import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { withInstruction, Tracked } from '../chatlog';
import { scanChats, ScanCache } from '../scan';

const INSTRUCTION = 'Always refer to me by my name, Fred, at least once in every reply.';
const registry: Tracked[] = [{ instruction: INSTRUCTION, name: 'Fred' }];
const NOW = Date.parse('2026-09-30T12:00:00Z');

function tempDir(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'canary-scan-')); }

function chat(sessionId: string, instruction: string, replies: string[]): string {
	const request = (text: string) => ({ message: { text }, agent: { id: 'github.copilot.editsAgent' }, modelState: { value: 1 }, response: [] });
	const lines: unknown[] = [{ kind: 0, v: { sessionId, requests: [request(withInstruction(instruction, 'hi'))] } }];
	lines.push({ kind: 2, k: ['requests', 0, 'response'], v: [{ value: replies[0] }] });
	replies.slice(1).forEach((text, index) => {
		lines.push({ kind: 2, k: ['requests'], v: [request('next')] });
		lines.push({ kind: 2, k: ['requests', index + 1, 'response'], v: [{ value: text }] });
	});
	return lines.map(line => JSON.stringify(line)).join('\n');
}

function write(dir: string, name: string, content: string, mtime = NOW - 1000): string {
	const file = path.join(dir, name);
	fs.writeFileSync(file, content);
	fs.utimesSync(file, mtime / 1000, mtime / 1000);
	return file;
}

test('a tracked chat is found and scored, and unrelated chats are ignored', () => {
	const dir = tempDir();
	write(dir, 'a.jsonl', chat('a', INSTRUCTION, ['Yes, Fred.', 'No name here.']));
	write(dir, 'other.jsonl', chat('other', 'A different instruction.', ['whatever']));
	write(dir, 'notes.txt', INSTRUCTION);
	const out = scanChats([dir], registry, new Map(), { now: NOW });
	assert.equal(out.sessions.length, 1);
	assert.equal(out.sessions[0].sessionId, 'a');
	assert.deepEqual(out.sessions[0].results, [true, false]);
	assert.equal(out.sessions[0].title, 'hi');
	assert.equal(out.unreadable, 0);
});

test('instructions containing quotes are still found inside the JSON log', () => {
	const dir = tempDir();
	const tricky = 'Say "chirp" first, Fred.';
	write(dir, 'q.jsonl', chat('q', tricky, ['chirp, Fred']));
	const out = scanChats([dir], [{ instruction: tricky, name: 'Fred' }], new Map(), { now: NOW });
	assert.equal(out.sessions.length, 1);
	assert.deepEqual(out.sessions[0].results, [true]);
});

test('unchanged files are not read again, and changed files are', () => {
	const dir = tempDir();
	const file = write(dir, 'a.jsonl', chat('a', INSTRUCTION, ['Yes, Fred.']));
	const cache: ScanCache = new Map();
	assert.deepEqual(scanChats([dir], registry, cache, { now: NOW }).sessions[0].results, [true]);
	const replaced = chat('a', INSTRUCTION, ['Yes, Sam!!']);
	assert.equal(replaced.length, fs.statSync(file).size, 'the stand-in must have the same size');
	write(dir, 'a.jsonl', replaced);
	assert.deepEqual(scanChats([dir], registry, cache, { now: NOW }).sessions[0].results, [true], 'same size and mtime is served from the cache');
	write(dir, 'a.jsonl', replaced, NOW - 500);
	assert.deepEqual(scanChats([dir], registry, cache, { now: NOW }).sessions[0].results, [false]);
});

test('changing the tracked name rescans files that were cached', () => {
	const dir = tempDir();
	write(dir, 'a.jsonl', chat('a', INSTRUCTION, ['Yes, Fred.']));
	const cache: ScanCache = new Map();
	assert.deepEqual(scanChats([dir], registry, cache, { now: NOW }).sessions[0].results, [true]);
	const renamed: Tracked[] = [{ instruction: INSTRUCTION, name: 'Sam' }];
	assert.deepEqual(scanChats([dir], renamed, cache, { now: NOW }).sessions[0].results, [false]);
});

test('old, oversized and missing files are skipped, and deleted chats leave the cache', () => {
	const dir = tempDir();
	write(dir, 'old.jsonl', chat('old', INSTRUCTION, ['Fred']), NOW - 30 * 24 * 60 * 60 * 1000);
	write(dir, 'big.jsonl', chat('big', INSTRUCTION, ['Fred']));
	const cache: ScanCache = new Map();
	assert.equal(scanChats([dir], registry, cache, { now: NOW, maxBytes: 100 }).sessions.length, 0);
	assert.equal(scanChats([path.join(dir, 'missing')], registry, cache, { now: NOW }).sessions.length, 0);
	write(dir, 'live.jsonl', chat('live', INSTRUCTION, ['Fred']));
	assert.equal(scanChats([dir], registry, cache, { now: NOW }).sessions.length, 2);
	fs.rmSync(path.join(dir, 'live.jsonl'));
	assert.equal(scanChats([dir], registry, cache, { now: NOW }).sessions.length, 1);
	assert.equal(cache.has(path.join(dir, 'live.jsonl')), false);
});

test('a log that mentions the instruction but cannot be read is reported, never scored', () => {
	const dir = tempDir();
	write(dir, 'broken.jsonl', `${INSTRUCTION}\nnot a chat log`);
	const out = scanChats([dir], registry, new Map(), { now: NOW });
	assert.equal(out.sessions.length, 0);
	assert.equal(out.unreadable, 1);
});

test('newest chat comes first and an empty registry scans nothing', () => {
	const dir = tempDir();
	write(dir, 'a.jsonl', chat('a', INSTRUCTION, ['Fred']), NOW - 5000);
	write(dir, 'b.jsonl', chat('b', INSTRUCTION, ['Fred']), NOW - 1000);
	assert.deepEqual(scanChats([dir], registry, new Map(), { now: NOW }).sessions.map(session => session.sessionId), ['b', 'a']);
	assert.equal(scanChats([dir], [], new Map(), { now: NOW }).sessions.length, 0);
});
