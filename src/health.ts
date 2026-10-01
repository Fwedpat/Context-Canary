export type HealthState = 'healthy' | 'fading' | 'dying';

export const stateLabel = (state: HealthState): string => state.charAt(0).toUpperCase() + state.slice(1);

export interface Adherence {
	checked: number;
	followed: number;
	missed: number;
	streak: number;
	firstMiss: number | undefined;
	state: HealthState;
}

// The wording is fixed, and the check in buildMatcher depends on it containing the name.
export function instructionFor(name: string): string {
	const trimmed = name.trim();
	return trimmed ? `Always refer to me by my name, ${trimmed}, at least once in every reply.` : '';
}

export function buildMatcher(name: string): RegExp | undefined {
	const trimmed = name.trim();
	if (!trimmed) { return undefined; }
	const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

export function followsInstruction(reply: string, matcher: RegExp): boolean {
	return matcher.test(reply);
}

export function normalizeMissesBeforeDying(value: number): number {
	return Number.isFinite(value) ? Math.min(10, Math.max(2, Math.floor(value))) : 2;
}

export function assessAdherence(results: readonly boolean[], missesBeforeDying: number): Adherence {
	const dyingAt = normalizeMissesBeforeDying(missesBeforeDying);
	let streak = 0;
	for (let i = results.length - 1; i >= 0 && !results[i]; i--) { streak++; }
	const missed = results.filter(result => !result).length;
	const firstMissIndex = results.indexOf(false);
	return {
		checked: results.length,
		followed: results.length - missed,
		missed,
		streak,
		firstMiss: firstMissIndex === -1 ? undefined : firstMissIndex + 1,
		state: streak >= dyingAt ? 'dying' : streak > 0 ? 'fading' : 'healthy'
	};
}

export function shouldNotify(previous: HealthState | undefined, current: HealthState): boolean {
	const severity: Record<HealthState, number> = { healthy: 0, fading: 1, dying: 2 };
	return severity[current] > (previous ? severity[previous] : 0);
}
