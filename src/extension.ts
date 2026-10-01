import * as path from 'node:path';
import * as vscode from 'vscode';
import { Tracked, withInstruction } from './chatlog';
import { assessAdherence, buildMatcher, HealthState, instructionFor, normalizeMissesBeforeDying, shouldNotify, stateLabel } from './health';
import { copilotHome, removeLegacyHook, removeLegacyState } from './legacy';
import { ScanCache, scanChats, SessionResult } from './scan';

interface Settings {
	name: string;
	missesBeforeDying: number;
	sendImmediately: boolean;
	notifications: boolean;
	promptOnNewChat: boolean;
}

const REGISTRY_KEY = 'canary.registry';
const SELECTED_KEY = 'canary.selectedChat';

function readSettings(): Settings {
	const config = vscode.workspace.getConfiguration('canary');
	return {
		name: config.get<string>('userName', '').trim(),
		missesBeforeDying: normalizeMissesBeforeDying(config.get<number>('missesBeforeDying', 2)),
		sendImmediately: config.get<boolean>('sendImmediately', true),
		notifications: config.get<boolean>('notifications', true),
		promptOnNewChat: config.get<boolean>('promptOnNewChat', true)
	};
}

async function askForName(): Promise<string | undefined> {
	const value = await vscode.window.showInputBox({
		title: 'Canary', ignoreFocusOut: true,
		prompt: 'What should the canary call you? It is how Copilot\'s replies are checked.',
		validateInput: input => input.trim() ? undefined : 'Enter a name'
	});
	const name = value?.trim();
	if (name) { await vscode.workspace.getConfiguration('canary').update('userName', name, vscode.ConfigurationTarget.Global); }
	return name;
}

function summary(session: SessionResult | undefined, missesBeforeDying: number, unreadable: number, pinned: boolean): vscode.MarkdownString {
	const markdown = new vscode.MarkdownString();
	if (!session) {
		markdown.appendMarkdown('**Canary: No chat yet**\n\nSend a message with **@canary**. It adds one small instruction to your message and passes it to Copilot, then checks whether Copilot\'s replies keep following it.');
	} else {
		const adherence = assessAdherence(session.results, missesBeforeDying);
		markdown.appendMarkdown(`**Canary: ${stateLabel(adherence.state)}**\n\n`);
		markdown.appendMarkdown(adherence.checked === 0
			? 'No Copilot reply has been checked yet.\n\n'
			: adherence.state === 'healthy'
				? 'Copilot\'s last reply still followed the instruction.\n\n'
				: `Copilot's last ${adherence.streak} repl${adherence.streak === 1 ? 'y' : 'ies'} ignored the instruction.\n\n`);
		markdown.appendMarkdown(`| ${pinned ? 'Chosen chat' : 'Latest tracked chat'} | |\n| :--- | ---: |\n`);
		markdown.appendMarkdown(`| Replies checked | ${adherence.checked} |\n`);
		markdown.appendMarkdown(`| Followed | ${adherence.followed} |\n`);
		markdown.appendMarkdown(`| Missed | ${adherence.missed}${adherence.firstMiss ? ` (first at reply ${adherence.firstMiss})` : ''} |\n`);
		markdown.appendMarkdown(`| Misses in a row | ${adherence.streak} |\n`);
		if (session.unscored) { markdown.appendMarkdown(`| Replies not checked (cancelled or failed) | ${session.unscored} |\n`); }
		if (session.inProgress) { markdown.appendMarkdown('\nCopilot is still replying.\n'); }
	}
	if (unreadable) { markdown.appendMarkdown(`\n\n${unreadable} saved chat(s) could not be read.`); }
	markdown.appendMarkdown('\n\n[Add to Chat](command:canary.addToChat) | [New Chat with Canary](command:canary.newChat) | [Choose Chat](command:canary.chooseChat) | [Settings](command:canary.openSettings)');
	markdown.isTrusted = { enabledCommands: ['canary.addToChat', 'canary.newChat', 'canary.chooseChat', 'canary.openSettings'] };
	return markdown;
}

export function activate(context: vscode.ExtensionContext) {
	const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
	// Each window reads only its own chats, so a notification is never shown twice.
	const chatDirs = () => context.storageUri
		? [path.join(path.dirname(context.storageUri.fsPath), 'chatSessions')]
		: [path.join(userDir, 'globalStorage', 'emptyWindowChatSessions')];

	const cache: ScanCache = new Map();
	const known = new Map<string, HealthState>();
	let sessions: SessionResult[] = [];
	let unreadable = 0;

	const status = vscode.window.createStatusBarItem('canary.health', vscode.StatusBarAlignment.Right, -10000);
	status.name = 'Canary';
	status.command = 'canary.showStatus';

	const registry = () => context.globalState.get<Tracked[]>(REGISTRY_KEY, []);
	const remember = async (item: Tracked) => {
		const others = registry().filter(existing => existing.instruction !== item.instruction || existing.name !== item.name);
		await context.globalState.update(REGISTRY_KEY, [item, ...others].slice(0, 20));
	};

	const render = () => {
		const settings = readSettings();
		const chosen = context.workspaceState.get<string>(SELECTED_KEY);
		const pinnedSession = chosen ? sessions.find(session => session.sessionId === chosen) : undefined;
		const latest = pinnedSession ?? sessions[0];
		const state = latest ? assessAdherence(latest.results, settings.missesBeforeDying).state : undefined;
		status.text = state === 'dying' ? '$(canary-dying)' : '$(canary-bird)';
		status.color = state === 'healthy' ? new vscode.ThemeColor('charts.yellow') : undefined;
		status.backgroundColor = state === 'dying' ? new vscode.ThemeColor('statusBarItem.errorBackground')
			: state === 'fading' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
		status.accessibilityInformation = { label: `Canary: ${state ? stateLabel(state) : 'No chat yet'}. Show details.` };
		status.tooltip = summary(latest, settings.missesBeforeDying, unreadable, !!pinnedSession);
		status.show();
	};

	const runChatCommand = async (command: string, ...args: unknown[]): Promise<boolean> => {
		try {
			const commands = await vscode.commands.getCommands(true);
			if (!commands.includes(command)) { throw new Error('Chat is not available in this VS Code window.'); }
			await vscode.commands.executeCommand(command, ...args);
			return true;
		} catch (error) {
			void vscode.window.showWarningMessage(`Canary: ${error instanceof Error ? error.message : 'Unable to open chat.'}`);
			return false;
		}
	};
	const addToChat = () => runChatCommand('workbench.action.chat.open', { query: '@canary ', isPartialQuery: true });
	const newChat = async () => {
		if (!await runChatCommand('workbench.action.chat.newChat')) { return; }
		const config = vscode.workspace.getConfiguration('canary');
		if (config.get<boolean>('promptOnNewChat', true)) {
			const answer = await vscode.window.showInformationMessage('Add @canary to this new chat?', 'Add Canary', "Don't Ask Again");
			if (answer === "Don't Ask Again") { await config.update('promptOnNewChat', false, vscode.ConfigurationTarget.Global); }
			if (!answer) { return; }
		}
		await addToChat();
	};

	// The click focuses the bird, so VS Code's own show-hover command reopens the hover and keeps it open.
	const showStatus = () => vscode.commands.executeCommand('workbench.action.showHover');

	// VS Code does not tell extensions which chat is open, so the user picks the one the bird follows.
	const chooseChat = async () => {
		const settings = readSettings();
		const chosen = context.workspaceState.get<string>(SELECTED_KEY);
		type Item = vscode.QuickPickItem & { id: string | undefined };
		const items: Item[] = [{ id: undefined, label: 'Follow the latest tracked chat', picked: !chosen }];
		for (const session of sessions) {
			const { state, checked } = assessAdherence(session.results, settings.missesBeforeDying);
			items.push({
				id: session.sessionId,
				label: session.title || 'Untitled chat',
				description: `${stateLabel(state)}, ${checked} repl${checked === 1 ? 'y' : 'ies'} checked`,
				detail: new Date(session.mtimeMs).toLocaleString(),
				picked: session.sessionId === chosen
			});
		}
		if (items.length === 1) {
			void vscode.window.showInformationMessage('Canary: No tracked chats yet. Send a message with @canary first.');
			return;
		}
		const pick = await vscode.window.showQuickPick(items, { title: 'Canary: Choose Chat', placeHolder: 'Which chat should the bird follow?' });
		if (!pick) { return; }
		await context.workspaceState.update(SELECTED_KEY, pick.id);
		render();
	};

	const refresh = (initial: boolean) => {
		const settings = readSettings();
		const output = scanChats(chatDirs(), registry(), cache, { now: Date.now() });
		sessions = output.sessions;
		unreadable = output.unreadable;
		for (const session of sessions) {
			const { state, streak } = assessAdherence(session.results, settings.missesBeforeDying);
			const previous = known.get(session.sessionId);
			known.set(session.sessionId, state);
			if (initial || !settings.notifications || !shouldNotify(previous, state)) { continue; }
			const message = state === 'fading'
				? 'Canary: Fading. Copilot\'s last reply ignored the canary instruction. Long chats can lose early instructions.'
				: `Canary: Dying. Copilot's last ${streak} replies ignored the canary instruction. Its early context is likely being lost; consider a new chat.`;
			void vscode.window.showWarningMessage(message, 'New Chat with Canary').then(answer => { if (answer) { void newChat(); } });
		}
		render();
	};

	let pending: NodeJS.Timeout | undefined;
	const scheduleRefresh = () => {
		clearTimeout(pending);
		pending = setTimeout(() => refresh(false), 800);
	};

	const participant = vscode.chat.createChatParticipant('canary.monitor', async (request, _chatContext, stream) => {
		const settings = readSettings();
		if (!settings.name) {
			const name = await askForName();
			if (!name) {
				stream.markdown('Canary needs a name to build and check its instruction. Nothing was sent to Copilot. Send your message again to be asked, or set `canary.userName`.');
				return;
			}
			settings.name = name;
		}
		const instruction = instructionFor(settings.name);
		if (!instruction || !buildMatcher(settings.name)) {
			stream.markdown('Canary needs a name to check replies. Nothing was sent to Copilot.');
			return;
		}
		await remember({ instruction, name: settings.name });
		const attachFiles: unknown[] = [];
		let skipped = 0;
		for (const reference of request.references) {
			const value = reference.value;
			if (value instanceof vscode.Uri && value.scheme === 'file') {
				attachFiles.push(value);
			} else if (value instanceof vscode.Location && value.uri.scheme === 'file') {
				attachFiles.push({ uri: value.uri, range: {
					startLineNumber: value.range.start.line + 1, startColumn: value.range.start.character + 1,
					endLineNumber: value.range.end.line + 1, endColumn: value.range.end.character + 1
				} });
			} else {
				skipped++;
			}
		}
		const query = withInstruction(instruction, request.prompt);
		// Kept short and free of instruction wording, because Copilot reads earlier assistant turns.
		stream.markdown(settings.sendImmediately ? 'Continue to prompt normally.' : 'Ready in the chat box.');
		if (skipped) { stream.markdown(` ${skipped} attachment(s) could not be carried over.`); }
		// Deferred so this request finishes before the message is submitted to the default agent.
		setTimeout(() => {
			void runChatCommand('workbench.action.chat.open', { query, isPartialQuery: !settings.sendImmediately, attachFiles });
			scheduleRefresh();
		}, 400);
	});
	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'canary.svg');

	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(chatDirs()[0]), '*.jsonl'));
	// File watching outside the workspace can miss events, so a slow poll backs it up.
	const poll = setInterval(() => refresh(false), 5000);
	context.subscriptions.push(status, participant, watcher,
		watcher.onDidCreate(scheduleRefresh), watcher.onDidChange(scheduleRefresh),
		{ dispose: () => { clearInterval(poll); clearTimeout(pending); } },
		vscode.commands.registerCommand('canary.addToChat', addToChat),
		vscode.commands.registerCommand('canary.showStatus', showStatus),
		vscode.commands.registerCommand('canary.chooseChat', chooseChat),
		vscode.commands.registerCommand('canary.newChat', newChat),
		vscode.commands.registerCommand('canary.setName', askForName),
		vscode.commands.registerCommand('canary.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Fwedpat.context-canary')),
		vscode.commands.registerCommand('canary.reset', async () => {
			await context.globalState.update(REGISTRY_KEY, []);
			await context.workspaceState.update(SELECTED_KEY, undefined);
			cache.clear();
			known.clear();
			refresh(true);
		}),
		vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('canary')) { render(); } })
	);

	refresh(true);
	if (removeLegacyHook(copilotHome())) {
		removeLegacyState(context.globalStorageUri.fsPath);
		void vscode.window.showInformationMessage('Canary removed the hook file an earlier version added to ~/.copilot/hooks. It is no longer needed.');
	}
	if (!context.globalState.get<boolean>('canary.welcomed')) {
		void context.globalState.update('canary.welcomed', true);
		void vscode.window.showInformationMessage('Canary is ready. Type @canary and your message: it adds one small instruction to the start of the message, passes it to Copilot, and watches whether Copilot keeps following it.', 'Add Canary').then(answer => {
			if (answer) { void addToChat(); }
		});
	}
}
