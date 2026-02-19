# Mac Mini M4 Setup Guide — StickToMusic Production Hub

## What you're building

```
Mac Mini M4 (always-on, never sleeps)
  |
  |-- YOUR account (zadebatal)
  |     |-- Claude Code (Opus 4.6) = coding, architecture, bug fixes
  |     |-- Terminal 1: main branch (production)
  |     |-- Terminal 2: redesign-test (local Vercel dev)
  |     |-- VS Code
  |
  |-- STM OPS account (sandboxed)
        |-- OpenClaw Gateway (port 18789, localhost only)
        |-- 3 Agents (each a Slack bot in your STM workspace):
        |     |-- Scout (Kimi K2.5)  — QA tester, visual browser testing
        |     |-- Patch (Opus 4.6)   — dev agent, backlog issues, PRs
        |     |-- Relay (Sonnet 4.6) — ops/alerts, deploy monitoring
        |-- Shared workspace with memory + session logs
        |-- Sandboxed Chrome (ops@gmail.com)
        |-- Dedicated GitHub account (stm-ops) for PRs
        |-- No access to your personal data
```

---

## PHASE 0: Before Mac mini arrives (do on laptop NOW)

These are things you can knock out right now while waiting for delivery.

### Step 1: Create the sandboxed ops email

This is a completely separate identity for your AI agents. Do this from your phone or an incognito/private browser window — don't do it in your normal browser where you're logged into your personal stuff.

1. Open an **incognito/private browser window**
2. Go to **gmail.com**
3. Click **"Create account"** (bottom of sign-in page)
4. Fill in:
   - First name: `STM`
   - Last name: `Ops`
   - Email: `sticktomusic.ops@gmail.com` (or `stm.operations@gmail.com` if taken)
   - Password: something strong — save it in your password manager (1Password, iCloud Keychain, etc.)
5. Complete the verification (phone number, etc.)
6. **Write down this email and password** — you'll need them on Mac mini day

### Step 2: Create an Apple ID for the ops account

Still in the incognito window:

1. Go to **appleid.apple.com**
2. Click **"Create Your Apple ID"**
3. Use the `sticktomusic.ops@gmail.com` email you just created
4. Set a password (can be different from the Gmail password — save both)
5. Complete verification
6. This Apple ID will be used for the sandboxed Mac user account later

### Step 3: Create a GitHub account for your dev agent

Still in the incognito window:

1. Go to **github.com**
2. Click **"Sign up"**
3. Use the `sticktomusic.ops@gmail.com` email
4. Username: `stm-ops` (or `sticktomusic-ops` if taken)
5. Complete the setup
6. **This is how your dev agent (Patch) will submit pull requests** — you'll review and merge them from your main GitHub account

### Step 4: Create a Slack workspace

This is where you'll chat with your agents. Each agent gets its own channel.

1. Go to **slack.com** in your normal browser (not incognito)
2. Click **"Create a new workspace"**
3. Sign in with your personal email: `zadebatal@gmail.com` — **YOU own this workspace**
4. Workspace name: `STM Ops` (or `StickToMusic HQ`)
5. When it asks "What's your team working on?" → skip or type "AI agent management"
6. Skip inviting people for now

Now create 3 channels:

7. Click the **"+"** next to "Channels" in the sidebar
8. Click **"Create a channel"**
9. Create these 3 channels (one at a time):

| Channel name | Description (paste this in) |
|---|---|
| `scout-qa` | QA testing reports, bug findings, screenshots |
| `patch-dev` | Code fixes, PR submissions, backlog work |
| `relay-ops` | Deploy monitoring, morning briefs, alerts |

10. You should now see all 3 channels in your sidebar
11. **Install the Slack app on your phone** so you get notifications from your agents

### Step 5: Back up your Claude memory + repo state

Open Terminal on your laptop and run these one at a time:

```bash
# First, make sure all your code is pushed to GitHub
cd ~/Desktop/sticktomusic-app
git push origin main
git push origin redesign-test
```

Wait for that to finish, then:

```bash
# Back up your Claude Code memory (54 sessions of context!)
# This creates a zip file on your Desktop
zip -r ~/Desktop/claude-memory-backup.zip ~/.claude/
```

Then:

```bash
# Back up your .env.local (has all your secret keys)
cp ~/Desktop/sticktomusic-app/.env.local ~/Desktop/env-backup.txt
```

Then:

```bash
# Note what version of Node you're running
node --version
# Write down the number it shows (probably v22.something)
```

### Step 6: Gather your API keys

Open your password manager or a secure note app (Apple Notes with a locked note works). Copy these values — you'll need them on setup day:

1. **Anthropic API key** — go to console.anthropic.com → API Keys → copy it
   - If you don't have one: click "Create Key", name it "Mac Mini", copy the key
   - This powers both Claude Code AND OpenClaw
2. **Firebase config** — open `~/Desktop/sticktomusic-app/.env.local` in any text editor, copy all the `REACT_APP_FIREBASE_*` values
3. **Vercel login** — you'll log in fresh on the Mac mini, no key needed
4. **GitHub** — you'll generate a new SSH key on the Mac mini, no need to copy your old one

### Step 7: Buy an HDMI dummy plug ($8-12 on Amazon)

Search Amazon for "HDMI dummy plug" or "HDMI display emulator." The Mac mini needs to think a monitor is plugged in, otherwise screen sharing won't work when you access it remotely from your laptop. Just a small adapter that plugs into the HDMI port.

---

## PHASE 1: Mac Mini Day 1 — Your Account Setup

This is everything you do when the Mac mini arrives. Budget about 1-2 hours.

### Step 1: Unbox and connect

1. Plug in the Mac mini to power
2. Connect a monitor (HDMI), keyboard, and mouse
3. Also plug in the **HDMI dummy plug** to the second HDMI port (so screen sharing works later when you unplug the real monitor)
4. Power it on

### Step 2: macOS setup wizard

The Mac will walk you through initial setup:

1. Choose your language and region
2. **Sign in with YOUR Apple ID** (zadebatal) — this is your primary account
3. Connect to your WiFi
4. Complete the rest of the wizard (Touch ID if available, etc.)

### Step 3: System settings for always-on operation

Once you're at the desktop:

1. Click the **Apple menu** (top-left) → **System Settings**
2. Go to **General** → **Sharing**:
   - Turn ON **"Remote Login"** (this lets you SSH from your laptop)
   - Turn ON **"Screen Sharing"** (this lets you VNC/remote desktop from your laptop)
3. Go to **Energy Saver** (or "Battery" depending on macOS version):
   - Turn ON **"Prevent automatic sleeping when the display is off"**
   - Turn ON **"Start up automatically after a power failure"**
4. Go to **Lock Screen**:
   - Set "Require password after screen saver" to **1 hour** or longer
5. Go to **Network** → **Wi-Fi** (or Ethernet if you plugged in a cable):
   - **Write down the IP address** shown here (e.g., `192.168.1.50`)
   - You'll need this to connect from your laptop

### Step 4: Install Amphetamine (keeps Mac awake 24/7)

1. Open the **App Store** (blue icon with "A" in the dock)
2. Search for **"Amphetamine"** (it's free)
3. Click **Get** → **Install**
4. Open Amphetamine (it appears as a little pill icon in your menu bar, top-right)
5. Click the pill icon → **"Start New Session"** → **"Indefinitely"**
6. Right-click the pill icon → **Preferences** → check **"Launch Amphetamine at Login"**

### Step 5: Install developer tools

Open **Terminal** (press Cmd+Space, type "Terminal", press Enter). Then paste and run these commands **one block at a time**:

**Install Homebrew (package manager):**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
- It will ask for your password — type it (you won't see characters, that's normal)
- It may say "Press RETURN to continue" — press Enter
- This takes a few minutes. Wait for it to finish.

**Add Homebrew to your path (so you can use the `brew` command):**
```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

**Install core tools:**
```bash
brew install git node@22 npm wget
```
- This also takes a few minutes. Wait for it to finish.

**Verify Node is installed:**
```bash
node --version
```
- Should show something like `v22.x.x`. If it doesn't, try closing Terminal and reopening it.

**Install Claude Code:**
```bash
npm install -g @anthropic-ai/claude-code
```

**Install Vercel CLI:**
```bash
npm install -g vercel
```

**Install VS Code:**
```bash
brew install --cask visual-studio-code
```

### Step 6: Set up Git and SSH key for GitHub

Still in Terminal:

**Configure Git with your name:**
```bash
git config --global user.name "Zade Batal"
git config --global user.email "zadebatal@gmail.com"
```

**Generate an SSH key (so GitHub knows this Mac is trusted):**
```bash
ssh-keygen -t ed25519 -C "zadebatal@gmail.com" -f ~/.ssh/id_ed25519 -N ""
```

**Show the key so you can copy it:**
```bash
cat ~/.ssh/id_ed25519.pub
```
- This prints a long line starting with `ssh-ed25519 ...`
- **Select the entire line** and copy it (Cmd+C)

**Now add it to GitHub:**

1. Open Safari → go to **github.com** → sign in as **zadebatal**
2. Click your profile picture (top-right) → **Settings**
3. In the left sidebar, click **"SSH and GPG keys"**
4. Click the green **"New SSH key"** button
5. Title: `Mac Mini M4`
6. Key: paste what you copied from Terminal (Cmd+V)
7. Click **"Add SSH key"**

**Test that it works:**
```bash
ssh -T git@github.com
```
- Type `yes` if it asks about fingerprint
- Should say "Hi zadebatal! You've been successfully authenticated"

### Step 7: Clone the repo and restore your data

```bash
cd ~/Desktop
git clone git@github.com:zadebatal/sticktomusic-app.git
cd sticktomusic-app
npm install
```
- `npm install` takes a few minutes — it's downloading all the project dependencies.

**Restore your .env.local:**

Option A — If your laptop is on the same WiFi, run this on the Mac mini:
```bash
scp YOUR_LAPTOP_USERNAME@YOUR_LAPTOP_IP:~/Desktop/env-backup.txt ~/Desktop/sticktomusic-app/.env.local
```
(Replace YOUR_LAPTOP_USERNAME and YOUR_LAPTOP_IP with your actual values)

Option B — Just open the env-backup.txt on your laptop, copy all the text, then on the Mac mini:
```bash
nano ~/Desktop/sticktomusic-app/.env.local
```
Paste the contents (Cmd+V), then press Ctrl+X → Y → Enter to save.

**Restore Claude Code memory:**

Option A — SCP from laptop:
```bash
scp YOUR_LAPTOP_USERNAME@YOUR_LAPTOP_IP:~/Desktop/claude-memory-backup.zip ~/Desktop/
unzip ~/Desktop/claude-memory-backup.zip -d ~/
```

Option B — AirDrop the `claude-memory-backup.zip` from your laptop to the Mac mini, then:
```bash
unzip ~/Desktop/claude-memory-backup.zip -d ~/
```

**Verify memory is in place:**
```bash
ls ~/.claude/projects/
```
Should show a folder with your project path in it.

### Step 8: Link Vercel

```bash
cd ~/Desktop/sticktomusic-app
vercel login
```
- It will open a browser window — sign in with your Vercel account
- Then:
```bash
vercel link
```
- When it asks "Link to existing project?" → **Yes**
- Select your sticktomusic project

### Step 9: Test everything works

**Test 1 — Main branch builds:**
```bash
cd ~/Desktop/sticktomusic-app
git checkout main
npm start
```
- Should open a browser to localhost:3000 showing your app
- Press Ctrl+C in Terminal to stop it when you're done checking

**Test 2 — Claude Code has your memory:**
```bash
cd ~/Desktop/sticktomusic-app
claude
```
- Claude Code should start up
- Type: `What branch strategy do we use?`
- It should know the answer from your 54 sessions of memory
- Type `/exit` to quit

### Step 10: Set up Figma MCP (design ↔ code bridge)

This lets Claude Code read your Figma designs and generate matching code — and also push your live UI back into Figma as editable designs.

> **Note**: This doesn't replace Subframe. Subframe is our component library (45 components, dark theme, Tailwind). Figma MCP is for when you want to work from a Figma mockup or share your live UI with a designer. They complement each other.

**Step A — Install the Figma desktop app:**

1. Go to **figma.com/downloads** in Safari
2. Download the **macOS** desktop app
3. Open the `.dmg` file and drag Figma to Applications
4. Open Figma and sign in with your account (or create a free one)

**Step B — Enable the MCP server in Figma:**

1. Open any Design file in Figma (create a blank one if needed)
2. In the top-right, click the **"</>"** icon to switch to **Dev Mode**
   - If you don't see Dev Mode, you may need a paid plan or the free dev mode beta
3. In the right panel (Inspect), look for **"Enable desktop MCP server"**
4. Click it — the server starts locally at `http://127.0.0.1:3845/mcp`

**Step C — Connect Claude Code to Figma:**

In Terminal, run Claude Code:
```bash
cd ~/Desktop/sticktomusic-app
claude
```

Then inside Claude Code, type:
```
/mcp add figma http://127.0.0.1:3845/mcp
```

That's it! Now when you're working with me (Claude Code), you can say things like:
- "Implement this Figma frame" (paste a Figma link)
- "Push this component to Figma so I can review the layout"
- "Match the spacing from this Figma design"

**What you can do with it:**

| Direction | What it does | Example |
|---|---|---|
| Figma → Code | Claude reads a Figma design and generates matching React code | "Build this settings page from the Figma mockup" |
| Code → Figma | Captures your live localhost UI and sends it to Figma as editable layers | "Send the current Studio page to Figma for review" |
| Design tokens | Claude reads your Figma variables (colors, spacing, fonts) | "Use the exact colors from our Figma design system" |

### Step 11: Set up SSH access from your laptop

On **your laptop** (not the Mac mini), open Terminal and run:

```bash
echo '
Host macmini
  HostName PUT_YOUR_MAC_MINI_IP_HERE
  User zadebatal
  ForwardAgent yes
' >> ~/.ssh/config
```

**Replace `PUT_YOUR_MAC_MINI_IP_HERE`** with the IP you wrote down in Step 3 (e.g., `192.168.1.50`).

Test it:
```bash
ssh macmini
```
- If it asks about fingerprint, type `yes`
- You should now be logged into the Mac mini from your laptop!
- Type `exit` to disconnect

From now on, you can work on the Mac mini from anywhere on your home network by typing `ssh macmini`.

---

## PHASE 2: Mac Mini Day 1 — OpenClaw + Agent Team Setup

This is where you set up the sandboxed account and your 3 AI agents. Budget about 1-2 hours.

### Step 1: Create the sandboxed macOS user

On the Mac mini (logged into YOUR account):

1. Click **Apple menu** → **System Settings**
2. Scroll down to **"Users & Groups"** in the sidebar
3. Click the **"+"** button (bottom left) to add a new user
   - If it asks for your password, enter it
4. Fill in:
   - Full Name: `STM Ops`
   - Account name: `stmops` (it may auto-fill this)
   - Password: something strong — **save this in your password manager**
   - Account type: **Standard** (NOT Administrator — this is important for security)
5. Click **"Create User"**

### Step 2: Log into the STM Ops account

1. Click **Apple menu** → **Log Out "Zade Batal"**
2. On the login screen, click **"STM Ops"**
3. Enter the password you just set
4. Complete any first-time setup prompts (skip Apple ID or use the ops Apple ID from Phase 0)

### Step 3: Install Homebrew and Node in the ops account

Open **Terminal** (Cmd+Space → type "Terminal" → Enter) and run these **one at a time**:

**Install Homebrew:**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
- Enter the STM Ops password when asked
- Press Enter when prompted
- Wait for it to finish (a few minutes)

**Add Homebrew to path:**
```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

**Install Node 22:**
```bash
brew install node@22
```

**Verify Node works:**
```bash
node --version
```
Should show `v22.x.x`.

### Step 4: Install OpenClaw

```bash
npm install -g openclaw@latest
```

Now run the setup wizard:
```bash
openclaw onboard --install-daemon
```

The wizard will ask you several questions. Here's what to pick:

1. **"Choose AI provider"** → Select **Anthropic (Claude)**
   - It will ask for your API key → **paste your Anthropic API key** from your secure notes

2. **"Choose default model"** → Pick **Opus 4.6** (we'll set per-agent models later)

3. **"Configure gateway port"** → Accept the default (**18789**)

4. **"Bind to"** → Accept **localhost only** (127.0.0.1) — this is a security setting

5. **"Install daemon?"** → **Yes** — this makes OpenClaw run 24/7 as a background service

### Step 5: Verify OpenClaw is running

```bash
openclaw gateway status
```
Should show the gateway is running on port 18789.

Open the dashboard:
```bash
openclaw dashboard
```
This opens a browser to http://127.0.0.1:18789/ — you should see the OpenClaw dashboard.

### Step 6: Create Slack bots (one for each agent)

You need to create 3 Slack "apps" — one for Scout, one for Patch, one for Relay. Each app becomes a bot in your Slack workspace.

**Do this 3 times** (once for each agent):

1. Open Safari → go to **api.slack.com/apps**
2. Sign in with your **personal email** (zadebatal@gmail.com — the one that owns the workspace)
3. Click the green **"Create New App"** button
4. Click **"From scratch"**
5. App Name: **`Scout`** (first time), then **`Patch`** (second time), then **`Relay`** (third time)
6. Pick workspace: **STM Ops** (the workspace you created in Phase 0)
7. Click **"Create App"**

Now for each app, you need to configure permissions:

8. In the left sidebar, click **"OAuth & Permissions"**
9. Scroll down to **"Scopes"** → **"Bot Token Scopes"**
10. Click **"Add an OAuth Scope"** and add these 4 scopes (one at a time):
    - `chat:write` (lets the bot send messages)
    - `channels:history` (lets the bot read channel messages)
    - `channels:read` (lets the bot see channel info)
    - `files:write` (lets the bot upload screenshots)

11. Scroll back up and click **"Install to Workspace"**
12. Click **"Allow"**
13. You'll see a **"Bot User OAuth Token"** — it starts with `xoxb-`
14. **Copy this token and save it** in your secure notes. Label it clearly:
    - `Scout Slack Token: xoxb-...`
    - `Patch Slack Token: xoxb-...`
    - `Relay Slack Token: xoxb-...`

Now enable events so the bot can receive messages:

15. In the left sidebar, click **"Event Subscriptions"**
16. Toggle **"Enable Events"** to ON
17. For the Request URL, enter: `http://127.0.0.1:18789/slack/events` (OpenClaw will handle this)
18. Under **"Subscribe to bot events"**, click **"Add Bot User Event"** and add:
    - `message.channels`
19. Click **"Save Changes"**

Finally, add each bot to its channel:

20. Open **Slack** (the app or web)
21. Go to the `#scout-qa` channel
22. Type `/invite @Scout` and press Enter
23. Go to `#patch-dev` → type `/invite @Patch`
24. Go to `#relay-ops` → type `/invite @Relay`

### Step 7: Configure your 3 agents in OpenClaw

Back in Terminal on the Mac mini (still logged in as STM Ops):

**Create the workspace directory:**
```bash
mkdir -p ~/openclaw-workspace
cd ~/openclaw-workspace
```

**Create the identity file (defines your agent team):**
```bash
cat > ~/openclaw-workspace/identity.md << 'EOF'
# STM Agent Team

## Scout (QA Agent)
- Role: QA lead for StickToMusic (https://sticktomusic.com)
- Model: Kimi K2.5 (native vision — can see the actual UI, not just DOM)
- Channel: #scout-qa
- Personality: Thorough, detail-oriented, reports bugs with screenshots
- Scope: Browser testing only. No code changes. No access to .env or credentials.

## Patch (Dev Agent)
- Role: Developer for StickToMusic backlog issues
- Model: Opus 4.6 (best reasoning and code quality for production PRs)
- Channel: #patch-dev
- Personality: Concise, writes clean PRs, follows existing code patterns
- Scope: Can read/write code in the repo. Submits PRs via stm-ops GitHub account. Never pushes to main directly.

## Relay (Ops Agent)
- Role: Operations monitor for StickToMusic infrastructure
- Model: Sonnet 4.6 (reliable, won't miss anything)
- Channel: #relay-ops
- Personality: Brief, alert-focused, escalates only when necessary
- Scope: Monitors Vercel deploys, checks site uptime, routes alerts. No code access.
EOF
```

**Now register each agent in OpenClaw's dashboard:**

1. Open the dashboard: go to **http://127.0.0.1:18789/** in Safari
2. Go to **Agents** (or equivalent section)
3. **Add Agent** for each:

| Name | Model | Slack Bot Token | Channel |
|------|-------|-----------------|---------|
| Scout | Kimi K2.5 | `xoxb-...` (Scout token) | #scout-qa |
| Patch | Opus 4.6 | `xoxb-...` (Patch token) | #patch-dev |
| Relay | Sonnet 4.6 | `xoxb-...` (Relay token) | #relay-ops |

### Step 8: Give each agent its mission (reverse prompting)

This is where you tell each agent what it's responsible for. Run these in Terminal:

**Scout — your QA tester:**
```bash
openclaw agent scout --message "You are the QA lead for StickToMusic (https://sticktomusic.com).
This is a React web app for music content creators with 5 main sections:
- Pages (social media accounts)
- Studio (create slideshows and videos)
- Schedule (post scheduling via Late.co)
- Analytics (Late.co stats)
- Settings (profile, theme, subscription)

Your job: Figure out what the most important user flows are and test them.
When you find bugs, broken buttons, console errors, or unexpected behavior,
post in #scout-qa with screenshots and steps to reproduce.

Start by exploring the app and building your own test plan."
```

**Patch — your developer:**
```bash
openclaw agent patch --message "You are a developer on the StickToMusic team.
The repo is at ~/Desktop/sticktomusic-app (React 18, Create React App, Firebase, Vercel).
You work on the stm-ops GitHub account and submit PRs — NEVER push to main directly.

When assigned a bug or feature:
1. Read the relevant files first — understand before changing
2. Make minimal, focused changes — don't refactor what you don't need to
3. Build-verify with 'npx react-scripts build' — if it fails, fix it before submitting
4. Create a PR with a clear title and description
5. Post the PR link in #patch-dev

IMPORTANT: Wait for task assignments from Zade. Don't make changes without being asked."
```

**Relay — your ops monitor:**
```bash
openclaw agent relay --message "You are the ops monitor for StickToMusic.
Your job: Watch for deploy failures, site downtime, and critical errors.

Check https://sticktomusic.com regularly. If the site is down or returns errors,
immediately alert in #relay-ops with details.

For non-critical issues, batch them into the morning brief.
You compile the daily morning brief at 8am PST — summarize:
- Site status (up/down, any errors)
- Vercel deploy results from the last 24 hours
- Any overnight alerts
- Overall health assessment"
```

### Step 9: Set up scheduled tasks (morning briefs)

These are cron jobs — automated tasks that run on a schedule.

```bash
# Relay sends morning brief every day at 8am PST
openclaw cron add --agent relay --schedule "0 8 * * *" --message "Compile today's morning brief:
1. Check https://sticktomusic.com — are all 5 tabs loading?
2. Check Vercel for any failed deploys in the last 24 hours
3. Summarize any alerts from overnight
4. Post the brief in #relay-ops
If anything critical is broken, tag it as URGENT."

# Scout runs full QA at 9am PST (after Relay's brief)
openclaw cron add --agent scout --schedule "0 9 * * *" --message "Run your full QA test suite.
Test all 5 main tabs. Check browser console for errors. Try creating and deleting a draft.
Post results in #scout-qa: what passed, what failed, any new issues since yesterday."
```

### Step 10: Make OpenClaw survive reboots

The `--install-daemon` flag from Step 4 should have already set this up. Verify:

```bash
launchctl list | grep openclaw
```

If you see a line with `ai.openclaw.gateway`, you're good. If not, create it manually:

```bash
mkdir -p ~/Library/LaunchAgents

cat > ~/Library/LaunchAgents/ai.openclaw.gateway.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.openclaw.gateway</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/opt/homebrew/bin/openclaw</string>
        <string>gateway</string>
        <string>--port</string>
        <string>18789</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/openclaw-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/openclaw-stderr.log</string>
</dict>
</plist>
PLIST

launchctl load ~/Library/LaunchAgents/ai.openclaw.gateway.plist
```

### Step 11: Invite stm-ops to your GitHub repo

This lets your dev agent (Patch) submit pull requests.

1. Open Safari → go to **github.com** → sign in as **zadebatal** (your main account)
2. Go to your repo: **github.com/zadebatal/sticktomusic-app**
3. Click **Settings** (tab at the top of the repo)
4. In the left sidebar, click **"Collaborators"** (under "Access")
5. Click **"Add people"**
6. Search for **`stm-ops`** (the GitHub account you created in Phase 0)
7. Click **"Add stm-ops to this repository"**
8. Set the role to **"Write"** — this lets Patch push branches and create PRs, but it cannot push directly to main

Now accept the invitation:

9. Open a **new incognito window**
10. Go to **github.com** → sign in as **stm-ops**
11. Go to **github.com/notifications** — you should see the invitation
12. Click **"Accept"**

### Step 12: Switch back to your main account

1. Click **Apple menu** → **Log Out "STM Ops"**
2. On the login screen, click **your account** (Zade Batal)
3. Log in with your password

OpenClaw is now running in the background under the STM Ops user. All 3 agents stay active even though you're on your account.

**Verify it's running:**
```bash
curl -s http://127.0.0.1:18789/health
```
Should return a response. If it does, everything is working!

**Check Slack** — your 3 agents should be online in their channels. Try sending a message in `#scout-qa` like "Scout, are you online?" and see if it responds.

---

## PHASE 3: Remote Access (work from your laptop)

### Step 1: Connect from your laptop over WiFi

On **your laptop**, open Terminal:

**SSH (command line access):**
```bash
ssh zadebatal@PUT_YOUR_MAC_MINI_IP_HERE
```
Replace the IP. If it works, you're in! Type `exit` to disconnect.

**Make it easier with an alias:**
```bash
echo '
Host macmini
  HostName PUT_YOUR_MAC_MINI_IP_HERE
  User zadebatal
  ForwardAgent yes
' >> ~/.ssh/config
```

Now you can just type:
```bash
ssh macmini
```

**Screen sharing (see the desktop):**
1. On your laptop, open **Finder**
2. In the menu bar, click **Go** → **Connect to Server...**
3. Type: `vnc://PUT_YOUR_MAC_MINI_IP_HERE`
4. Click **Connect**
5. Enter your Mac mini password when prompted
6. You'll see the Mac mini's desktop on your laptop screen

### Step 2: Access from outside your home (optional)

If you want to access the Mac mini when you're not on your home WiFi:

1. On the Mac mini, install Tailscale:
```bash
brew install tailscale
```
2. On your laptop, install Tailscale:
```bash
brew install tailscale
```
3. On both machines, sign in with the same account
4. Now you can SSH from anywhere: `ssh macmini.your-tailnet-name`

---

## PHASE 4: Daily Operating Workflow

### Morning routine (5 min from your phone)

```
1. Open Slack on your phone
2. Check #relay-ops — Relay's 8am system status brief
3. Check #scout-qa — Scout's 9am full QA report
4. If URGENT flagged → SSH into Mac mini, hotfix on main
5. If Scout found bugs → message Patch: "Fix [bug]. See Scout's report."
6. If all clear → start your day, agents keep watching
```

### Coding session (you + Claude Code)

```
1. SSH into Mac mini: ssh macmini
2. cd ~/Desktop/sticktomusic-app
3. claude
4. Give batched tasks: "Fix these 3 bugs: [list]"
5. I (Claude Code/Opus) fix, build-verify, commit, push
6. Vercel auto-deploys → Scout auto-tests → reports in #scout-qa
```

### Delegating to Patch

When there's a simple bug or backlog item, let Patch handle it:

```
1. In Slack #patch-dev: "Patch, fix the console warning in
   AnalyticsDashboard.jsx — the useEffect deps array is missing
   'artistId'. Create a PR."
2. Patch reads the file, makes the fix, builds, creates a PR
3. Patch posts the PR link in #patch-dev
4. You open the PR on GitHub, review the code, merge if it looks good
```

**Rule of thumb:**
- **You + Claude Code (Opus):** Architecture, multi-file changes, anything touching App.jsx or core services
- **Patch (Opus via OpenClaw):** Single-file fixes, lint warnings, backlog items, simple feature additions

### End of day

```
1. git status — make sure nothing is uncommitted
2. Check #scout-qa and #relay-ops for any alerts
3. Optionally message Patch with tomorrow's backlog items
```

---

## Security checklist

Think of your agents like new hires — they get their own accounts, scoped access, nothing more.

**Sandboxing:**
- [ ] OpenClaw runs in sandboxed macOS user (no admin access)
- [ ] OpenClaw Chrome profile uses ops@gmail.com (not your personal)
- [ ] Gateway bound to localhost only (127.0.0.1:18789)

**Credential isolation:**
- [ ] OpenClaw does NOT have Firebase admin credentials
- [ ] OpenClaw does NOT have Late API keys
- [ ] Agents use dedicated `stm-ops` GitHub account (Write access only, can't push to main)
- [ ] .env.local is in .gitignore (never committed)
- [ ] OpenClaw has NO access to your personal accounts (email, social, banking)

**Communication safety:**
- [ ] Slack bots are in dedicated channels only (not in your personal DMs)
- [ ] NEVER add agent bots to public Slack channels or external group chats (prompt injection risk)
- [ ] If using Telegram as backup: DM-only, never group chats

**Infrastructure:**
- [ ] Mac mini has FileVault encryption enabled
- [ ] SSH access uses key auth (password auth disabled)
- [ ] Keep OpenClaw updated: `npm update -g openclaw@latest`
- [ ] Patch's PRs are ALWAYS reviewed by you before merging — never auto-merge

---

## Model strategy

```
YOUR account (zadebatal) — Claude Code
  Model: Opus 4.6
  Why: Best reasoning, best for architecture and multi-file refactors
  Usage: Only when YOU are actively coding

STM OPS account (stmops) — OpenClaw Agents
  Scout (QA):   Kimi K2.5   — native vision, can SEE the UI (not just read DOM)
  Patch (Dev):  Opus 4.6    — best code quality, PRs go into production
  Relay (Ops):  Sonnet 4.6  — reliable monitoring, won't miss anything
  Web search:   Brave Search — built-in, no extra config needed
```

**Why Kimi K2.5 for Scout?** It has native vision — trained on text AND images together. So when it tests your site, it can actually *look* at the rendered page and catch visual bugs (layout breaks, overlapping text, wrong colors, broken images) that DOM-only testing would miss. It's also free on OpenClaw right now.

**Why Opus for Patch?** Patch's code goes into your production app. You want the best reasoning model writing those PRs so you can trust the changes and spend less time reviewing.

**Why Sonnet 4.6 for Relay?** Monitoring is straightforward but needs reliability. Sonnet is more than capable and won't hallucinate false alerts.

---

## Troubleshooting

**Mac mini won't respond to SSH:**
- Make sure it's powered on (check if the power light is on)
- Make sure Remote Login is enabled: System Settings → General → Sharing → Remote Login
- Make sure you're on the same WiFi network
- Try pinging it: `ping PUT_YOUR_MAC_MINI_IP_HERE`

**Mac mini went to sleep:**
- Check if Amphetamine is running (pill icon in menu bar)
- Check HDMI dummy plug is plugged in
- System Settings → Energy → make sure "Prevent sleeping" is ON

**OpenClaw stops running:**
```bash
# SSH into the Mac mini, then check logs:
tail -100 /tmp/openclaw-stderr.log

# Restart the gateway:
launchctl unload ~/Library/LaunchAgents/ai.openclaw.gateway.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.gateway.plist
```

**Agent not responding in Slack:**
- Check if OpenClaw gateway is running: `curl -s http://127.0.0.1:18789/health`
- Check if the bot is in the channel: type `/invite @Scout` in the channel
- Check OpenClaw dashboard for error logs

**Claude Code lost memory after transfer:**
```bash
ls ~/.claude/projects/-Users-zadebatal-Desktop-sticktomusic-app/memory/
# Should show: MEMORY.md, sessions-18-31.md, sessions-32-54.md, subframe-patterns.md
```

**Can't screen share:**
- Make sure Screen Sharing is ON: System Settings → General → Sharing → Screen Sharing
- Make sure the HDMI dummy plug is in the second HDMI port
- Try VNC: open Finder → Go → Connect to Server → `vnc://YOUR_MAC_MINI_IP`
