import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseChat, scoreChat, Tracked } from './chatlog';

export interface SessionResult {
	file: string;
	sessionId: string;
	mtimeMs: number;
	instruction: string;
	name: string;
	title: string;
	results: boolean[];
	unscored: number;
	inProgress: boolean;
}

interface CacheEntry {
	mtimeMs: number;
	size: number;
	registryKey: string;
	result: SessionResult | undefined;
	unreadable: boolean;
}

export type ScanCache = Map<string, CacheEntry>;

export interface ScanOptions {
	now: number;
	maxAgeMs?: number;
	maxBytes?: number;
}

export interface ScanOutput {
	sessions: SessionResult[];
	unreadable: number;
}

const DAY = 24 * 60 * 60 * 1000;

// Only files that contain a known instruction are parsed, and unchanged files are never re-read.
export function scanChats(dirs: readonly string[], registry: readonly Tracked[], cache: ScanCache, options: ScanOptions): ScanOutput {
	const maxAge = options.maxAgeMs ?? 14 * DAY;
	const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
	const registryKey = registry.map(item => `${item.instruction}\u0000${item.name}`).join('\u0001');
	const needles = registry.map(item => JSON.stringify(item.instruction).slice(1, -1));
	const seen = new Set<string>();
	const sessions: SessionResult[] = [];
	let unreadable = 0;
	if (!registry.length) { return { sessions, unreadable }; }
	for (const dir of dirs) {
		let names: string[];
		try { names = fs.readdirSync(dir); } catch { continue; }
		for (const name of names.filter(item => item.endsWith('.jsonl'))) {
			const file = path.join(dir, name);
			let stat: fs.Stats;
			try { stat = fs.statSync(file); } catch { continue; }
			if (options.now - stat.mtimeMs > maxAge || stat.size > maxBytes) { continue; }
			seen.add(file);
			let entry = cache.get(file);
			if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size || entry.registryKey !== registryKey) {
				entry = { mtimeMs: stat.mtimeMs, size: stat.size, registryKey, result: undefined, unreadable: false };
				try {
					const text = fs.readFileSync(file, 'utf8');
					if (needles.some(needle => text.includes(needle))) {
						const chat = parseChat(text);
						const score = chat ? scoreChat(chat, registry) : undefined;
						if (!chat) { entry.unreadable = true; }
						if (score) {
							entry.result = {
								file, sessionId: score.sessionId ?? path.basename(name, '.jsonl'), mtimeMs: stat.mtimeMs,
								instruction: score.tracked.instruction, name: score.tracked.name, title: score.title,
								results: score.results, unscored: score.unscored, inProgress: score.inProgress
							};
						}
					}
				} catch { entry.unreadable = true; }
				cache.set(file, entry);
			}
			if (entry.unreadable) { unreadable++; }
			if (entry.result) { sessions.push(entry.result); }
		}
	}
	for (const file of cache.keys()) { if (!seen.has(file)) { cache.delete(file); } }
	return { sessions: sessions.sort((a, b) => b.mtimeMs - a.mtimeMs), unreadable };
}
