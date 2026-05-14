# Building Windows Installers for Orca Coder

## Quick Start: GitHub Actions (Recommended)

1. **Push the workflow** to GitHub:
   ```bash
   git add .github/workflows/build-windows.yml
   git commit -m "Add Windows build workflow"
   git push origin main
   ```

2. **Trigger the build** (either):
   - **UI:** [Actions → Build Windows installer](austindixson/orca/actions/workflows/build-windows.yml) → “Run workflow”
   - **CLI:** from the repo root, with [GitHub CLI](https://cli.github.com/): `gh workflow run "Build Windows installer" --repo austindixson/orca`
   - Wait on the order of **~10–15 minutes** (Rust + Tauri bundle).

3. **Download the installer**:
   - Open the completed run on the **Actions** tab
   - Under **Artifacts**, download **`orca-coder-windows-<commit-sha>`** (NSIS `.exe` and/or MSI in the zip)
   - Pushing a **version tag** `v*` also runs the workflow and attaches the same files to a **GitHub Release** (when the release job finds matching bundles)

## Alternative: Build on Windows

If you prefer to build locally:

### Option A: Use a Windows VM
1. Download [Windows Dev VM](https://developer.microsoft.com/en-us/windows/downloads/virtual-machines/)
2. Install Node.js, Rust, and run:
   ```bash
   npm install
   npm run tauri build
   ```
3. Find installer in: `src-tauri/target/release/bundle/nsis/`

### Option B: Use Cross-Compilation (Advanced)

Set up macOS → Windows cross-compilation:

```bash
# Install MinGW cross-compiler
brew install mingw-w64

# Add Windows target (already done)
rustup target add x86_64-pc-windows-msvc

# Set up cross-compilation environment
export CC=x86_64-w64-mingw32-gcc
export CXX=x86_64-w64-mingw32-g++

# Build (may still fail due to dependencies)
npm run tauri build -- --target x86_64-pc-windows-gnu
```

Note: Cross-compilation often fails due to native dependencies.

## Current Status

❌ **Cross-compilation from macOS to Windows failed** (missing Windows toolchain)
✅ **GitHub Actions workflow created** (recommended approach)
✅ **Frontend builds successfully** (ready for Windows build)

## Next Steps

1. **Push the workflow to GitHub** and trigger it manually
2. **Download your Windows installer** from the Actions artifacts
3. **Test the installer** on a Windows machine

The GitHub Actions approach is the most reliable and doesn't require local Windows setup!