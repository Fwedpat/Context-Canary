# Change Log

## 0.0.5

- Repackaged the extension.

## 0.0.4

- Fixed the Canary instruction, removed its settings controls, and capitalised visible bird-state labels.
- Clicking the status-bar bird now opens its hover controls.
- Added **Choose Chat** to pick which tracked chat the bird follows.

## 0.0.3

- Updated the `@canary` chat confirmation to "Continue to prompt normally."

## 0.0.2

- Marketplace listing renamed to Context Canary under publisher `Fwedpat`.
- Added a PNG extension icon and updated the listing description.

## 0.0.1

- `@canary` puts one instruction at the start of your message and passes it to Copilot, which answers with all its tools. Canary does not answer for it.
- Every Copilot reply after that is checked for the instruction, read from VS Code's saved chat file. Nothing is sent anywhere and no hook is installed.
- The status bar bird is healthy, fading after one miss, and dying after two in a row. Hover shows replies followed and missed. Notifications fire when it gets worse.
- Commands to start a new chat with Canary, set your name, and reset.
- Settings for the name, the instruction, a custom check pattern, how many misses kill the canary, and whether the message is sent immediately.
- Limits: your message appears twice, the saved-chat format is not a stable API, and compaction can't be detected.
