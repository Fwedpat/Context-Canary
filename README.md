# Context Canary

A canary for your Copilot chat. Canary adds one tiny instruction to a message, passes the message to Copilot, and checks every Copilot reply for it. When Copilot stops following it, the bird in the status bar starts to die: the chat's context is rotting.

Copilot answers your messages as normal, with all its tools. Canary only adds the instruction and keeps score.

## How it works

1. Type `@canary` and your message in a chat, or click the bottom-right bird and choose **Add to Chat** in its window to put `@canary` in the chat box.
2. The first time, Canary asks what to call you.
3. Canary sends your message to Copilot as a normal message, with a short instruction added above it. This is the only time the instruction is sent. It is never repeated, so Copilot has to keep remembering it.
4. Carry on chatting with Copilot as usual. You don't need `@canary` again.
5. Canary reads Copilot's replies from VS Code's saved chat and checks each one for your name. The bird follows the result: yellow when the last reply followed the instruction, amber after one miss, red after two in a row.

Hover the bird to see replies checked, followed and missed, and misses in a row. Click it and the same window opens and stays open, so you can use its **Add to Chat**, **New Chat with Canary** and **Settings** links. The top-right bird in the Chat view still starts a new Canary chat. You get a notification when the canary gets worse, with a button to start a fresh chat.

## What you'll see

Your message appears in the chat with a line of text above it, because that is how Copilot receives it. Canary doesn't show that line anywhere else, and its wording is fixed: it isn't a setting.

The `@canary` message before it just says "Continue to prompt normally." Canary keeps it short and doesn't describe the instruction there: in testing, Copilot treated instruction-like text in an earlier reply as suspicious and ignored it.

## Bird states

| State | When |
| --- | --- |
| Healthy | Copilot's last reply followed the instruction. |
| Fading | The last reply missed it. |
| Dying | Two replies in a row missed it (`canary.missesBeforeDying`). |

A canary that follows the instruction again returns to healthy, but the misses stay in the counts. The bird shows the most recently active tracked chat by default. VS Code doesn't tell extensions which chat is open, so to follow a different one, click **Choose Chat** in the bird's window and pick it from the list. Pick **Follow the latest tracked chat** to go back.

## How replies are read

VS Code saves every chat as a file on your computer. Canary looks in the saved chats for this window, finds one where a Copilot message starts with your instruction, and checks every Copilot reply from that message on. Files that don't contain your instruction are never parsed. Nothing is sent anywhere, and Canary doesn't keep the text of replies.

Replies that are still being written, cancelled or empty are not scored, so they can never count as misses.

## Limits

- **The instruction is only in the message you send through `@canary`.** A chat that Copilot has already answered can still be tracked: use `@canary` for a message in it, and scoring starts there. Earlier replies aren't judged.
- **Your message appears twice.** First as your `@canary` message, then as the message Canary passes to Copilot. Canary asks VS Code to attach files and selections you referenced, and says so if another kind of attachment can't be carried over. Check that attachments arrived before relying on them.
- **It reads a saved-chat format VS Code does not promise to keep.** If it changes, chats are reported as unreadable, never as misses.
- **The check is a text match:** your name as a whole word, ignoring case. A reply can mention the name without really following the instruction.
- **A miss shows one instruction was lost, not everything.** A follow does not prove the rest is remembered.
- **It can't tell you when Copilot compacts a chat.** VS Code doesn't expose that to extensions.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `canary.userName` | empty | The name Canary asks Copilot to use. Asked for on first use. |
| `canary.missesBeforeDying` | `2` | Misses in a row before the bird is dying, 2 to 10. |
| `canary.sendImmediately` | `true` | Send the message to Copilot straight away. When off, it is placed in the chat box for you to review and send. |
| `canary.notifications` | `true` | Notify when the canary gets worse. |
| `canary.promptOnNewChat` | `true` | Ask before adding `@canary` to chats started with Canary: New Chat with Canary. |

The instruction itself is fixed. It can't be changed in the settings.

## Commands

| Command | What it does |
| --- | --- |
| Canary: Add to Chat | Prefills `@canary` in the chat box. |
| Canary: New Chat with Canary | Opens a new chat and offers to add `@canary`. |
| Canary: Set Name | Changes the name Canary uses. |
| Canary: Choose Chat | Picks which tracked chat the bird follows. |
| Canary: Settings | Opens Canary's settings. |
| Canary: Clear Last Reading | Forgets tracked instructions and resets the bird. |
