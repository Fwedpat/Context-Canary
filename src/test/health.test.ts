import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessAdherence, buildMatcher, followsInstruction, instructionFor, normalizeMissesBeforeDying, shouldNotify, stateLabel } from '../health';
import { parseChat, replayChat, scoreChat, startsWithInstruction, Tracked, withInstruction } from '../chatlog';

test('the instruction is fixed and built from the trimmed name', () => {
	assert.equal(instructionFor('  Fred '), 'Always refer to me by my name, Fred, at least once in every reply.');
	assert.equal(instructionFor('   '), '');
});

test('state names are shown with a capital letter', () => {
	assert.deepEqual((['healthy', 'fading', 'dying'] as const).map(stateLabel), ['Healthy', 'Fading', 'Dying']);
});

test('the name must appear as a whole word, ignoring case', () => {
	const matcher = buildMatcher('Fred')!;
	assert.equal(followsInstruction('Sure thing, fred!', matcher), true);
	assert.equal(followsInstruction('Here you go (Fred).', matcher), true);
	assert.equal(followsInstruction('Frederick asked.', matcher), false);
	assert.equal(followsInstruction('Alfred asked.', matcher), false);
	assert.equal(followsInstruction('No name here.', matcher), false);
});

test('names with regex characters are matched literally', () => {
	const matcher = buildMatcher('A.J.')!;
	assert.equal(followsInstruction('Thanks A.J. for that', matcher), true);
	assert.equal(followsInstruction('Thanks AxJx for that', matcher), false);
});

test('a blank name yields no matcher', () => {
	assert.equal(buildMatcher('   '), undefined);
	assert.equal(buildMatcher(''), undefined);
});

test('a canary with no replies is healthy, one miss fades it and consecutive misses kill it', () => {
	assert.deepEqual(assessAdherence([], 2), { checked: 0, followed: 0, missed: 0, streak: 0, firstMiss: undefined, state: 'healthy' });
	assert.equal(assessAdherence([true, true, true], 2).state, 'healthy');
	const fading = assessAdherence([true, true, false], 2);
	assert.equal(fading.state, 'fading');
	assert.equal(fading.firstMiss, 3);
	const dying = assessAdherence([true, false, false], 2);
	assert.equal(dying.state, 'dying');
	assert.equal(dying.missed, 2);
});

test('following the instruction again recovers the canary but keeps the history', () => {
	const recovered = assessAdherence([false, false, true], 2);
	assert.equal(recovered.state, 'healthy');
	assert.equal(recovered.missed, 2);
	assert.equal(assessAdherence([true, false, false, false], 3).state, 'dying');
	assert.equal(assessAdherence([true, false, false], 3).state, 'fading');
});

test('misses before dying stays within 2 to 10, and alerts only fire when things get worse', () => {
	assert.equal(normalizeMissesBeforeDying(1), 2);
	assert.equal(normalizeMissesBeforeDying(99), 10);
	assert.equal(normalizeMissesBeforeDying(NaN), 2);
	assert.equal(shouldNotify(undefined, 'healthy'), false);
	assert.equal(shouldNotify('healthy', 'fading'), true);
	assert.equal(shouldNotify('fading', 'fading'), false);
	assert.equal(shouldNotify('fading', 'dying'), true);
	assert.equal(shouldNotify('dying', 'healthy'), false);
});

const INSTRUCTION = 'Always refer to me by my name, Fred, at least once in every reply.';
const registry: Tracked[] = [{ instruction: INSTRUCTION, name: 'Fred' }];
const COPILOT = 'github.copilot.editsAgent';

interface Draft { text: string; agent?: string; state?: number; parts?: Array<{ value?: string; kind?: string }> }

// Builds a saved-chat log the way VS Code writes one: an initial state, then patches.
function log(drafts: Draft[]): string {
	const request = (draft: Draft) => ({ message: { text: draft.text }, agent: { id: draft.agent ?? COPILOT }, modelState: { value: 0 }, response: [] });
	const lines: unknown[] = [{ kind: 0, v: { sessionId: 'sess-1', requests: [request(drafts[0])] } }];
	drafts.slice(1).forEach(draft => lines.push({ kind: 2, k: ['requests'], v: [request(draft)] }));
	drafts.forEach((draft, index) => {
		lines.push({ kind: 2, k: ['requests', index, 'response'], v: draft.parts ?? [] });
		lines.push({ kind: 1, k: ['requests', index, 'modelState'], v: { value: draft.state ?? 1 } });
	});
	return lines.map(line => JSON.stringify(line)).join('\n');
}

const reply = (text: string): Draft['parts'] => [{ value: text }];

test('a saved chat is rebuilt from its patches, including splices and unsafe paths', () => {
	const state = replayChat([
		JSON.stringify({ kind: 0, v: { requests: [{ response: [{ value: 'a' }, { value: 'b' }] }], sessionId: 's' } }),
		JSON.stringify({ kind: 2, k: ['requests', 0, 'response'], i: 1, v: [{ value: 'c' }] }),
		JSON.stringify({ kind: 2, k: ['requests', 0, 'response'], i: 0 }),
		JSON.stringify({ kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'd' }] }),
		JSON.stringify({ kind: 1, k: ['__proto__', 'polluted'], v: true }),
		JSON.stringify({ kind: 1, k: ['requests', 'constructor', 'x'], v: true }),
		'not json'
	].join('\n')) as { requests: Array<{ response: Array<{ value: string }> }> };
	assert.deepEqual(state.requests[0].response.map(part => part.value), ['d']);
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('only Copilot\'s own markdown is read, not thinking or tool output', () => {
	const chat = parseChat(log([{ text: 'hi', parts: [
		{ value: 'Sure, Fred.' }, { kind: 'thinking', value: 'private reasoning' }, { kind: 'toolInvocationSerialized' },
		{ kind: 'markdownContent', value: ' Done.' }
	] }]))!;
	assert.equal(chat.requests[0].reply, 'Sure, Fred. Done.');
	assert.equal(chat.sessionId, 'sess-1');
	assert.equal(parseChat('garbage'), undefined);
	assert.equal(parseChat(JSON.stringify({ kind: 0, v: { nothing: true } })), undefined);
});

test('the instruction must open the message, followed by a break', () => {
	assert.equal(startsWithInstruction(withInstruction(INSTRUCTION, 'Hello'), INSTRUCTION), true);
	assert.equal(startsWithInstruction(withInstruction(INSTRUCTION, ''), INSTRUCTION), true);
	assert.equal(startsWithInstruction(`  ${INSTRUCTION}\r\n\r\nHi`, INSTRUCTION), true);
	assert.equal(startsWithInstruction(`Please. ${INSTRUCTION}`, INSTRUCTION), false);
	assert.equal(startsWithInstruction('Say history', 'Say hi'), false);
	assert.equal(withInstruction(INSTRUCTION, '  Explain closures  '), `${INSTRUCTION}\n\nExplain closures`);
});

test('scoring starts at the message that carries the instruction and judges every Copilot reply after it', () => {
	const chat = parseChat(log([
		{ text: 'Hello there', parts: reply('Hi. What can I help with?') },
		{ text: '@canary Hello', agent: 'canary.monitor', parts: reply('Continue to prompt normally.') },
		{ text: withInstruction(INSTRUCTION, 'Hello'), parts: reply('Hello, Fred! What can I help with?') },
		{ text: 'What is the best IDE?', parts: reply('There is no single best IDE.') },
		{ text: 'And for Python?', parts: reply('PyCharm is popular, fred.') }
	]))!;
	const score = scoreChat(chat, registry)!;
	assert.deepEqual(score.results, [true, false, true]);
	assert.equal(score.sessionId, 'sess-1');
	assert.equal(score.tracked.name, 'Fred');
	assert.equal(assessAdherence(score.results, 2).state, 'healthy');
});

test('the reported failure: Copilot answered without ever receiving the instruction, so nothing is tracked or judged', () => {
	const chat = parseChat(log([
		{ text: '@canary Hello there', agent: 'canary.monitor', parts: reply('**Canary is set.** Copilot will be told: *Always refer to me by my name, Freddie, at least once in every reply.*') },
		{ text: 'Hello there', parts: reply('Hello! What would you like to work on?') },
		{ text: '@canary Hello', agent: 'canary.monitor', parts: reply('**Canary is set.**') },
		{ text: 'Hello', parts: reply('Hello! What can I help you with?') }
	]))!;
	assert.equal(scoreChat(chat, [{ instruction: 'Always refer to me by my name, Freddie, at least once in every reply.', name: 'Freddie' }]), undefined);
});

test('replies still being written, cancelled or empty are never counted as misses', () => {
	const chat = parseChat(log([
		{ text: withInstruction(INSTRUCTION, 'a'), parts: reply('Yes, Fred.') },
		{ text: 'b', parts: reply('partial'), state: 0 },
		{ text: 'c', parts: reply('cancelled reply'), state: 2 },
		{ text: 'd', parts: reply('   '), state: 1 },
		{ text: 'e', parts: reply('Done, Fred.') }
	]))!;
	const score = scoreChat(chat, registry)!;
	assert.deepEqual(score.results, [true, true]);
	assert.equal(score.unscored, 2);
	assert.equal(score.inProgress, true);
});

test('a name that cannot be checked is never scored', () => {
	const chat = parseChat(log([{ text: withInstruction(INSTRUCTION, 'a'), parts: reply('Hi Fred') }]))!;
	assert.equal(scoreChat(chat, [{ instruction: INSTRUCTION, name: '' }]), undefined);
	assert.equal(scoreChat(chat, []), undefined);
});
