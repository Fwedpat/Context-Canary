import { buildMatcher, followsInstruction } from './health';

export interface LoggedRequest {
	text: string;
	agentId: string | undefined;
	state: number | undefined;
	reply: string;
}

export interface LoggedChat {
	sessionId: string | undefined;
	requests: LoggedRequest[];
}

export interface Tracked {
	instruction: string;
	name: string;
}

export interface ChatScore {
	sessionId: string | undefined;
	tracked: Tracked;
	title: string;
	results: boolean[];
	unscored: number;
	inProgress: boolean;
}

// Observed in saved chats: 0 is still running and 1 is complete. Any other value is left unscored.
const COMPLETE = 1;
const PENDING = 0;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// VS Code saves a chat as a log of patches over one initial state. The format is not a stable API.
export function replayChat(text: string): unknown {
	let state: unknown;
	for (const line of text.split('\n')) {
		if (!line.trim()) { continue; }
		let op: unknown;
		try { op = JSON.parse(line); } catch { continue; }
		if (!isRecord(op)) { continue; }
		if (op.kind === 0) { state = op.v; continue; }
		const path = op.k;
		if (!isRecord(state) || !Array.isArray(path) || path.length === 0 || path.some(key => UNSAFE_KEYS.has(String(key)))) { continue; }
		let parent: unknown = state;
		for (const key of path.slice(0, -1)) { parent = isRecord(parent) ? parent[String(key)] : undefined; }
		if (!isRecord(parent)) { continue; }
		const last = String(path[path.length - 1]);
		if (op.kind === 1) {
			parent[last] = op.v;
		} else if (op.kind === 2) {
			const list = parent[last];
			if (!Array.isArray(list)) { continue; }
			if (typeof op.i === 'number' && op.i >= 0 && op.i < list.length) { list.length = op.i; }
			if (Array.isArray(op.v)) { list.push(...op.v); }
		}
	}
	return state;
}

function replyOf(response: unknown): string {
	if (!Array.isArray(response)) { return ''; }
	return response
		.filter(part => isRecord(part) && (part.kind === undefined || part.kind === 'markdownContent') && typeof part.value === 'string')
		.map(part => (part as { value: string }).value).join('');
}

export function parseChat(text: string): LoggedChat | undefined {
	const state = replayChat(text);
	if (!isRecord(state) || !Array.isArray(state.requests)) { return undefined; }
	const requests = state.requests.filter(isRecord).map((request): LoggedRequest => {
		const message = isRecord(request.message) ? request.message.text : undefined;
		const agent = isRecord(request.agent) ? request.agent.id : undefined;
		const modelState = isRecord(request.modelState) ? request.modelState.value : undefined;
		return {
			text: typeof message === 'string' ? message : '',
			agentId: typeof agent === 'string' ? agent : undefined,
			state: typeof modelState === 'number' ? modelState : undefined,
			reply: replyOf(request.response)
		};
	});
	return { sessionId: typeof state.sessionId === 'string' ? state.sessionId : undefined, requests };
}

const isCopilot = (request: LoggedRequest) => request.agentId?.startsWith('github.copilot') === true;

const normalize = (text: string) => text.replace(/\r\n/g, '\n').trimStart();

export function startsWithInstruction(text: string, instruction: string): boolean {
	const normalized = normalize(text);
	if (!normalized.startsWith(instruction)) { return false; }
	const next = normalized.charAt(instruction.length);
	return next === '' || /\s/.test(next);
}

// Scoring starts at the message that carries the instruction; earlier messages are never judged.
export function scoreChat(chat: LoggedChat, registry: readonly Tracked[]): ChatScore | undefined {
	let anchor = -1;
	let tracked: Tracked | undefined;
	for (const [index, request] of chat.requests.entries()) {
		if (!isCopilot(request)) { continue; }
		tracked = registry.find(item => startsWithInstruction(request.text, item.instruction));
		if (tracked) { anchor = index; break; }
	}
	if (!tracked) { return undefined; }
	const matcher = buildMatcher(tracked.name);
	if (!matcher) { return undefined; }
	const title = normalize(chat.requests[anchor].text).slice(tracked.instruction.length).replace(/\s+/g, ' ').trim().slice(0, 60);
	const score: ChatScore = { sessionId: chat.sessionId, tracked, title, results: [], unscored: 0, inProgress: false };
	for (const request of chat.requests.slice(anchor)) {
		if (!isCopilot(request)) { continue; }
		if (request.state === PENDING || request.state === undefined) {
			score.inProgress = true;
		} else if (request.state === COMPLETE && request.reply.trim()) {
			score.results.push(followsInstruction(request.reply, matcher));
		} else {
			score.unscored++;
		}
	}
	return score;
}

export function withInstruction(instruction: string, prompt: string): string {
	const body = prompt.trim();
	return body ? `${instruction}\n\n${body}` : instruction;
}
