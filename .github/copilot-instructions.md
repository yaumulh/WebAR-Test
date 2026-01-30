# GitHub Copilot instructions for rs-wayfinderV2 🔧

> NOTE: workspace currently appears empty (no Assets/, Packages/, or README found). This file is a pragmatic starter template tailored for a Unity-based project—please update with real paths/examples after adding project files.

## Purpose ✅
- Give AI coding agents immediate, repository-specific context so they can make productive, low-risk edits for a Unity project.

## Big-picture architecture to look for 🔍
- Look for Unity-specific roots: `Assets/`, `Packages/`, `ProjectSettings/`, `Packages/manifest.json`, `ProjectSettings/ProjectVersion.txt`.
- Typical components you'll see: Scenes (`Assets/Scenes/`), runtime code (`Assets/Scripts/`), Editor tools (`Assets/Editor/`), Tests (`Assets/Tests/`), Assembly Definitions (`*.asmdef`).
- When these are present, prefer cross-assembly edits in code that respects `asmdef` boundaries.

## Workflow & build commands ⚙️
- Editor builds (local): open in Unity Editor.
- CLI build (Windows example):
  - Unity Hub / Unity Editor CLI: `Unity.exe -batchmode -quit -projectPath "<repo-path>" -buildWindowsPlayer "Builds/Win/mygame.exe" -logFile build.log`
- Run tests via CLI:
  - `Unity.exe -batchmode -projectPath "<repo-path>" -runTests -testPlatform EditMode -testResults TestResults/editmode.xml -logFile test.log`
  - Use `PlayMode` for PlayMode tests.

## Code & project conventions to preserve ✍️
- Respect `asmdef` boundaries: add references by editing the asmdef's `references` rather than editing all scripts into a single namespace.
- Use Unity Test Runner for both EditMode and PlayMode tests.
- If `Addressables` or `ScriptableObject` configs exist, treat them as canonical runtime data (do not hardcode paths).

## Integration points & external dependencies 🔗
- Look for `Packages/manifest.json` for package dependencies (Scoped Registries, git URLs).
- If there is `com.unity.*` packages or external git packages, prefer editing package version ranges rather than pinning arbitrary commits unless tests require it.

## PR & Review guidance for AI agents 🧭
- Make focused, small PRs (one feature/fix per PR). Include which scenes or tests were exercised.
- When change touches assemblies or packages, run tests and include test results in PR description.

## Examples (replace after repo is populated) 💡
- Adding a simple utility: place in `Assets/Scripts/Utilities/`, add tests in `Assets/Tests/Utilities/`, and add an `asmdef` if cross-assembly usage is required.
- Fixing build pipeline: prefer editing CI YAML or Unity build script under `Assets/Editor/Build/`.

## What I couldn't discover in this workspace ⚠️
- No code, tests, build scripts, or README were found. Please add or point to:
  - Key entry scenes (e.g., `Assets/Scenes/Main.unity`)
  - Build scripts or CI workflows (`.github/workflows/*.yml`)
  - Any project-specific conventions (naming, branching, release process)

---
If this looks reasonable, I can: (1) update the file with concrete paths/examples after you add the repo files, or (2) adapt this to your actual CI/build scripts if you paste them here. What would you like next?