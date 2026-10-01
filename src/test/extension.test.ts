import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Canary Extension', () => {
	test('registers the participant and every command on activation', async () => {
		const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'context-canary'
			&& item.packageJSON.publisher === 'Fwedpat');
		assert.ok(extension, 'Canary extension should be installed in the test host');
		await extension.activate();
		const commands = await vscode.commands.getCommands(true);
		for (const command of ['canary.addToChat', 'canary.showStatus', 'canary.newChat', 'canary.setName', 'canary.chooseChat', 'canary.openSettings', 'canary.reset']) {
			assert.ok(commands.includes(command), `${command} must be registered`);
		}
		const participant = extension.packageJSON.contributes.chatParticipants[0];
		assert.strictEqual(participant.name, 'canary');
		assert.notStrictEqual(participant.isSticky, true, 'a sticky participant would swallow the message it passes to Copilot');
		const icon = vscode.Uri.joinPath(extension.extensionUri, 'media', 'canary-icons.woff');
		assert.ok((await vscode.workspace.fs.stat(icon)).size > 0, 'Bird font must be bundled');
	});

	test('the manifest exposes the settings Canary reads and no leftover hook machinery', () => {
		const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'context-canary')!;
		const properties = Object.keys(extension.packageJSON.contributes.configuration.properties);
		for (const key of ['userName', 'missesBeforeDying', 'sendImmediately', 'notifications', 'promptOnNewChat']) {
			assert.ok(properties.includes(`canary.${key}`), `canary.${key} must be a setting`);
		}
		for (const key of ['instruction', 'expectedPattern', 'alwaysOn', 'forwardPrompt']) {
			assert.ok(!properties.includes(`canary.${key}`), `canary.${key} must not be a setting`);
		}
		assert.strictEqual(extension.packageJSON.scripts['vscode:uninstall'], undefined);
	});

	test('clicking the bird reopens its hover instead of opening a popup, and the hover keeps its links', async () => {
		const extension = vscode.extensions.getExtension('Fwedpat.context-canary')!;
		await extension.activate();
		const contributes = extension.packageJSON.contributes;
		assert.strictEqual(contributes.menus['view/title'][0].command, 'canary.newChat');
		assert.deepStrictEqual(contributes.menus.commandPalette, [{ command: 'canary.showStatus', when: 'false' }],
			'the click handler needs the focused bird, so it is hidden from the Command Palette');

		const originalInfo = vscode.window.showInformationMessage;
		const originalExecute = vscode.commands.executeCommand;
		const executed: Array<{ command: string; args: unknown[] }> = [];
		let popups = 0;
		try {
			vscode.window.showInformationMessage = (() => { popups++; return Promise.resolve(undefined); }) as typeof vscode.window.showInformationMessage;
			vscode.commands.executeCommand = (async (command: string, ...args: unknown[]) => {
				if (command === 'workbench.action.showHover' || command === 'workbench.action.chat.open') {
					executed.push({ command, args });
					return undefined;
				}
				return originalExecute(command, ...args);
			}) as typeof vscode.commands.executeCommand;

			await originalExecute('canary.showStatus');
			assert.deepStrictEqual(executed, [{ command: 'workbench.action.showHover', args: [] }]);
			assert.strictEqual(popups, 0, 'no popup may open on click');

			executed.length = 0;
			await originalExecute('canary.addToChat');
			assert.deepStrictEqual(executed, [{
				command: 'workbench.action.chat.open', args: [{ query: '@canary ', isPartialQuery: true }]
			}]);
		} finally {
			vscode.window.showInformationMessage = originalInfo;
			vscode.commands.executeCommand = originalExecute;
		}
	});
});
