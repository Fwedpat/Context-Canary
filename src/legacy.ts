import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const OWN_MARKER = 'Fwedpat.context-canary';

export function copilotHome(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
	return env.COPILOT_HOME || path.join(home, '.copilot');
}

// An earlier version installed a hook file. Only a file that points at this extension is touched.
export function removeLegacyHook(copilotDir: string): boolean {
	const file = path.join(copilotDir, 'hooks', 'canary.json');
	try {
		if (!fs.readFileSync(file, 'utf8').includes(OWN_MARKER)) { return false; }
		fs.rmSync(file, { force: true });
		return true;
	} catch {
		return false;
	}
}

export function removeLegacyState(storageDir: string): void {
	for (const name of ['config.json', 'sessions', 'hook-error.log']) {
		try { fs.rmSync(path.join(storageDir, name), { recursive: true, force: true }); } catch { /* best effort */ }
	}
}
