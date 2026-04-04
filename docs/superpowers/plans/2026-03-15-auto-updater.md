# Auto-Update via GitHub Releases Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-update functionality that checks GitHub Releases for new versions and offers in-app install via a toast notification.

**Architecture:** Tauri's `tauri-plugin-updater` checks a `latest.json` endpoint on GitHub Releases. A React hook polls on startup + every 4 hours. A toast component renders under the titlebar. A GitHub Actions workflow builds and releases on every push to main with auto-generated date-based versions.

**Tech Stack:** tauri-plugin-updater (Rust + JS), @tauri-apps/plugin-updater, tauri-apps/tauri-action, GitHub Actions

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src-tauri/Cargo.toml` | Modify | Add `tauri-plugin-updater` dependency |
| `src-tauri/tauri.conf.json` | Modify | Add updater plugin config with pubkey + endpoint |
| `src-tauri/src/lib.rs` | Modify | Register updater plugin |
| `package.json` | Modify | Add `@tauri-apps/plugin-updater` dependency |
| `src/hooks/use-update-checker.ts` | Create | Hook: check, download, install logic + state |
| `src/components/layout/update-toast.tsx` | Create | Toast UI under titlebar |
| `src/App.tsx` | Modify | Render `UpdateToast` |
| `.github/workflows/release.yml` | Create | CI: build + release on push to main |

---

## Chunk 1: Backend Setup

### Task 1: Generate signing keys

**Files:** None (CLI only, output goes to GitHub Secrets + tauri.conf.json)

- [ ] **Step 1: Generate the key pair**

Run:
```bash
npx tauri signer generate -w ~/.tauri/EverythingBrowser.key
```

This outputs a public key to stdout and saves the private key to the file. Save both.

- [ ] **Step 2: Note the public key**

Copy the public key string (starts with `dW5...`). This goes into `tauri.conf.json` in the next task.

- [ ] **Step 3: Add private key + password as GitHub Secrets**

Go to `https://github.com/sjroesink/EverythingBrowser/settings/secrets/actions` and add:
- `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/EverythingBrowser.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you entered (or empty string if none)

---

### Task 2: Add Rust dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add tauri-plugin-updater to dependencies**

Add this line to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors (warnings OK)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat: add tauri-plugin-updater dependency"
```

---

### Task 3: Configure updater in tauri.conf.json

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add bundle.createUpdaterArtifacts and updater plugin config**

In `src-tauri/tauri.conf.json`, add `createUpdaterArtifacts` to `bundle` (new key at top level) and add `updater` to the existing `plugins` object:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<PASTE_YOUR_PUBLIC_KEY_HERE>",
      "endpoints": [
        "https://github.com/sjroesink/EverythingBrowser/releases/latest/download/latest.json"
      ]
    }
  }
}
```

Note: `pubkey` must be replaced with the actual key from Task 1 Step 2.

- [ ] **Step 2: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: configure updater plugin with GitHub Releases endpoint"
```

---

### Task 4: Register plugin in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs:49-55`

- [ ] **Step 1: Add the updater plugin to the builder chain**

In `src-tauri/src/lib.rs`, add `.plugin(tauri_plugin_updater::Builder::new().build())` to the `tauri::Builder::default()` chain, after the existing plugins (around line 55):

```rust
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ConnectionManager::new())
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: register updater plugin in Tauri builder"
```

---

## Chunk 2: Frontend

### Task 5: Install npm dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `npm install @tauri-apps/plugin-updater`

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @tauri-apps/plugin-updater npm package"
```

---

### Task 6: Create use-update-checker hook

**Files:**
- Create: `src/hooks/use-update-checker.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateState {
  available: boolean;
  version: string | null;
  body: string | null;
  downloading: boolean;
  progress: number; // 0-100
  readyToRestart: boolean;
  dismissed: boolean;
  error: string | null;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
}

const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

export function useUpdateChecker(): UpdateState {
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [readyToRestart, setReadyToRestart] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      setError(null);
      const update = await check();
      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        setBody(update.body ?? null);
        setAvailable(true);
        setDismissed(false);
      }
    } catch (e) {
      console.warn("Update check failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    try {
      setDownloading(true);
      setProgress(0);
      setError(null);

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });

      setDownloading(false);
      setReadyToRestart(true);
    } catch (e) {
      setDownloading(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Check on mount + every 4 hours
  useEffect(() => {
    // Delay initial check by 5 seconds to not block startup
    const timeout = setTimeout(() => {
      void checkForUpdate();
    }, 5000);

    const interval = setInterval(() => {
      void checkForUpdate();
    }, CHECK_INTERVAL);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  return {
    available,
    version,
    body,
    downloading,
    progress,
    readyToRestart,
    dismissed,
    error,
    checkForUpdate,
    installUpdate,
    dismiss,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors related to `use-update-checker.ts`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-update-checker.ts
git commit -m "feat: add useUpdateChecker hook for auto-update"
```

---

### Task 7: Create UpdateToast component

**Files:**
- Create: `src/components/layout/update-toast.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { Download, RefreshCw, X } from "lucide-react";
import type { UpdateState } from "@/hooks/use-update-checker";
import { relaunch } from "@tauri-apps/plugin-process";

interface UpdateToastProps {
  update: UpdateState;
}

export function UpdateToast({ update }: UpdateToastProps) {
  if (!update.available || update.dismissed) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-accent/90 border-b border-accent-border text-sm text-accent-foreground">
      {update.readyToRestart ? (
        <>
          <RefreshCw className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            Update v{update.version} geinstalleerd.
          </span>
          <button
            onClick={() => void relaunch()}
            className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Herstarten
          </button>
        </>
      ) : update.downloading ? (
        <>
          <Download className="w-4 h-4 shrink-0 animate-pulse" />
          <span className="flex-1">
            Downloaden... {update.progress}%
          </span>
          <div className="w-32 h-1.5 bg-foreground/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${update.progress}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <Download className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            Update beschikbaar: v{update.version}
          </span>
          <button
            onClick={() => void update.installUpdate()}
            className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Installeren
          </button>
          <button
            onClick={update.dismiss}
            className="p-1 rounded hover:bg-foreground/10 transition-colors"
            title="Later"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/update-toast.tsx
git commit -m "feat: add UpdateToast component for update notifications"
```

---

### Task 8: Integrate UpdateToast into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

Add at the top of `src/App.tsx` with the other imports:

```typescript
import { useUpdateChecker } from "@/hooks/use-update-checker";
import { UpdateToast } from "@/components/layout/update-toast";
```

- [ ] **Step 2: Add the hook call**

Inside `App()`, after the `useTheme()` call (line 56), add:

```typescript
const updateState = useUpdateChecker();
```

- [ ] **Step 3: Add the toast to the JSX**

In the return JSX, add `<UpdateToast>` right after `<Titlebar>` (after line 652):

```tsx
<Titlebar onOpenSettings={openSettingsWindow} />
<UpdateToast update={updateState} />
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate update toast into main app layout"
```

---

## Chunk 3: CI/CD

### Task 9: Create GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Release

on:
  push:
    branches:
      - main

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: true

jobs:
  publish-tauri:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            args: ''

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Generate version
        id: version
        shell: bash
        run: |
          VERSION="0.1.$(date -u +'%Y%m%d%H%M%S')"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "Generated version: $VERSION"

      - name: Patch version in project files
        shell: bash
        run: |
          VERSION="${{ steps.version.outputs.version }}"

          # Patch tauri.conf.json
          sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json

          # Patch Cargo.toml (only the package version, not dependency versions)
          sed -i '0,/^version = ".*"/s//version = "'"$VERSION"'"/' src-tauri/Cargo.toml

          # Patch package.json
          sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: lts/*

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable

      - name: Install frontend dependencies
        run: npm install

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v${{ steps.version.outputs.version }}
          releaseName: 'v${{ steps.version.outputs.version }}'
          releaseBody: 'Automated release from commit ${{ github.sha }}'
          releaseDraft: false
          prerelease: false
          includeUpdaterJson: true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat: add GitHub Actions workflow for auto-release on push to main"
```

---

## Chunk 4: Final Verification

### Task 10: End-to-end verification

- [ ] **Step 1: Verify full build locally**

Run: `npm run build && cd src-tauri && cargo build`
Expected: both frontend and backend compile without errors

- [ ] **Step 2: Verify signing keys are configured**

Confirm that:
- `src-tauri/tauri.conf.json` has the real public key (not placeholder)
- GitHub Secrets has `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

- [ ] **Step 3: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "feat: complete auto-update setup"
```

- [ ] **Step 4: Push to main to trigger first release**

```bash
git push origin main
```

Check `https://github.com/sjroesink/EverythingBrowser/actions` for the workflow run.
After it completes, verify the release at `https://github.com/sjroesink/EverythingBrowser/releases`.
