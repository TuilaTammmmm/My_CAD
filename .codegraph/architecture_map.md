# Architecture Map & Dependency Network
> **AI Token-Saving Notice**: This repository is indexed by ReduceToken. Do NOT scan the full folder. Consult this map or run `rt query <symbol>` (or `reducetoken query`) to find exact code paths.

## 1. Quick Stats
- **Indexed Files**: 26
- **Indexed Symbols**: 141
- **Entry Points**: index.html, src/main.js

## 2. Critical God Nodes & Architectural Chokepoints
> **Blast-Radius Alert**: Modifying these central nodes affects many downstream modules.

- `src/main.js` — **Central Orchestrator** (In: 0 callers, Out: 15 deps)
- `src/occt-kernel.js` — **Foundational Core** (In: 4 callers, Out: 0 deps)
- `src/cloud-library.js` — **Foundational Core** (In: 2 callers, Out: 0 deps)
- `src/cad-script.js` — **Foundational Core** (In: 1 callers, Out: 1 deps)
- `src/storage.js` — **Foundational Core** (In: 2 callers, Out: 0 deps)
- `src/cad2d-editor.js` — **Central Orchestrator** (In: 1 callers, Out: 2 deps)

## 3. Module Directory Structure
### `(root)` (6 files)
- `index.html`
- `package.json`
- `start.bat`
- `vite.config.js`
- `.gitignore`
- `README.md`
### `.github` (1 files)
- `.github/copilot-instructions.md`
### `api` (1 files)
- `api/models.js` — defines: `createModelsHandler, timingSafeEqualStr, sha256Hex, sanitizeText`
### `src` (18 files)
- `src/cad-engine.js` — defines: `CadEngine, isPointInTriangle, isPointInFace, getAdjacentFaceNormals`
- `src/cad-script.js` — defines: `rotateBrushAroundY, executeCadScript, getNativeMethod, nativeClone`
- `src/cad2d-editor.js` — defines: `CAD2DEditor, getTouchPoint, projectPointOnLine, toCanvasX`
- `src/cloud-library-ui.js` — defines: `initCloudLibraryUI, formatShortDate, createBadge, setStatus`
- `src/cloud-library.js` — defines: `captureViewportThumbnail, setStoredAdminPin, loadCloudModelData, fetchCloudModels`
- `src/dimension-overlay.js` — defines: `DimensionOverlay`
- `src/dxf-exporter.js` — defines: `DXFExporter, addLine, addCircle, addArc`
- `src/exporter.js` — defines: `exportToOBJ`
- `src/grid-overlay.js` — defines: `GridOverlay`
- `src/main.js` — defines: `requestRender, clearHistory, disposeEdges, saveHistory`
- `src/measure-tool.js` — defines: `InspectionTool, vKey, fmt, fmt`
- `src/occt-kernel.js` — defines: `getOCCTError, getOC, isOCCTReady, replicadToBrush`
- `src/picker.js` — defines: `InteractivePicker, addSharpVert, eKey, updateMouseFromEvent`
- `src/preview.js` — defines: `CutterPreview, testFn, intersectFn, to3D`
- `src/projection-engine.js` — defines: `ProjectionEngine, vKey`
- `src/projection-screens.js` — defines: `ProjectionScreensOverlay`
- `src/storage.js` — defines: `clearProjectState, loadProjectState, saveProjectState, openDB`
- `src/style.css`

## 4. How AI Agents Query & Fast Read (Token Saving Guide)
To avoid reading full multi-hundred line files and save up to 95% tokens:
1. **Locate Target**: Run `rt query <symbol_or_keyword>` (or MCP `query_code_graph`).
   - Returns `TARGET FILE: path/to/file.py` and exact line numbers (e.g. `[L42]`).
2. **Targeted Line Read**: Call `read_file(Path='path/to/file.py', StartLine=35, EndLine=70)` to read only the target function.
   - **NEVER** read the entire file if you only need one class or method.
3. **Inspect Callers & Deps**: Inspect only the 1-hop files listed in `IMPORTS` or `IMPORTED BY`.
4. **Open Visual Web Graph**: Run `rt web` to explore the complete dependency network in browser.
