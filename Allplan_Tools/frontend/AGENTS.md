<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- The neutral-suite integration is accepted into main; keep the isolated RC1 recipe separate and preserve source rollback references until explicit launcher alignment. Post-merge evidence requests do not authorize deployment or runtime migration.
- Suite `/` imports no plugin state/routes and restores theme on exit. Static native home uses only Copilot HomeApi; icons accept exact local plugin endpoints with one-way fallback independent of launch. Why: isolate host launches without weakening plugin identity.
- ModuleGate + shared/transport/native-binding verify the native identity (get_app_info only, id/app_id normalised, strict match) before mounting; connectHost re-checks it before initial data. A binding without identity is blocked, never a browser fallback; a shared origin never grants another app_id's capabilities.
- Module exits go through suite/leave-guard: only a re-verified confirmed save or explicit discard leaves; downloads are never native saves.
- Information Manager keeps its own presentation (aim.css linked by its route) and namespaced storage via aimStorage; its RC1 code is not duplicated, only the aim_legacy parser.
- AIM follows its nested AGENTS.md: exact Copilot contracts, projectInstallation membership, single presentation-only shared dialog consumer and separately gated export coordinated with update acknowledgements. Form group IDs stay intact; edits move rows only to changed destinations. Why: preserve Python facts, occurrence identity and order.
- AIM legacy requires an explicit launcher getAppInfo identity verified before mount; chrome.webview alone is only an engine signal, and host-object proxies are read once with await only after that verification.
- Subdirectories have their own AGENTS.md; read it before changing files there.
- Formula favourites use explicit settings, a shared single-target resolver and atomic catalog application.
- Models use a separate hydrated settings store with save-on-exit and import/export; atomic insertion keeps edits outside catalog history.
- TemplateMenus shares ribbon/context choices; catalog-to-model copies components and values, ignores links and preserves history.
- Ribbon option menus open by right-click or keyboard only (never long press), so every toolbar button drags identically; manager menus open on click.
- AttributeValueField shares typed catalog/model/external controls; ChoiceCombo shares searchable choices. Saved room occupancy resolves cross-language indices without rewriting data.
- Catalog uses one Zustand store with snapshot undo/redo to keep tree, selection and history consistent.
- useT() shares room translations; partial dictionaries fall back to EN.
- Fixed-height windowed trees support 10k+ nodes; shared tree-sticky/StickyTreeParents overlays preserve row/drop coordinates.
- Editable trees reveal and scroll to creations, by virtual row index or row ID.
- Deterministic sample IDs prevent hydration mismatches.
- Hierarchy and placement share canContain()/resolveInsertion() in catalog-store.ts; folder choices resume captured actions only on confirmation, while edge moves keep explicit positions.
- Folder icon row drops use copyFolderIcon() with folder-only validation and catalog snapshots — copies remain undoable and never move the source icon.
- Editor, manager and model menus share CustomToolbar and the presentation-only toolbar-layout store; native drag-and-drop moves groups/buttons without modifying catalog history.
- Headings use catalog-panel-heading. Dense rows share row-alt and row markers; virtual trees use absolute indices. Selection, provenance and drop feedback win.
- Secondary dialogs share catalog-panel-heading/secondary-dialog-footer; draggable rows use RowDragGrip under data-draggable-row for consistent hover grips and unbroken headings.
- Search filtering goes through matchNode()/makeTester() with SearchOpts in the store — tree, result count and replace-all share one matcher.
- Attribute transfer (copy/cut/drag onto tree) goes through atomic transferAttrs(); transferAttr() delegates single rows to it, preserving per-type validation and one undo entry per batch; row order is stored in node.attrOrder.
- Catalog manager swaps store `view`, replacing tree/properties without another route.
- Resource manager and bottom quick menus share catalog metadata; options preserve tree/history, and PythonPart reads files.
- Resource-manager default attribute choices live in src/lib/default-attributes.ts, separate from editable node attributes; the manager and status bar share these names and use 0 for no default.
- Layer/fill bundles complete at atomic commit; pattern/color stays portable until official mapping; texture browsing preserves Design subfolders, never filename-only fallback.
- Global CSS centralizes native, Radix and compound checkbox artwork.

- Built-in models are identified by stable reserved IDs and protected in the settings store; plain catalog add actions read them so all add entry points share defaults.
- Shared secondary Dialog owns bounded movement/resizing and restores browser-local geometry by stable layout ID after mount; fixed-size dialogs opt out, keeping personal window layouts separate from catalog history.
- Model attribute exclusions are enforced in settings mutations and catalog application, with picker filtering for immediate feedback.

- Catalog and model toolbar reordering share moveSelectionInOrder; stable sibling partitions keep batch moves ordered and catalog moves atomic in history.
- Order favorites/folders persist together; active order mirrors panel/drag, independently of manager selection.
- External libraries use validated session lists and undoable imports targeting main selection. Offer export before browsing changed settings; aliases never rename files, folder picks provide relative names.

- Drop previews share CSS tokens; external rows own copy drags; previews clear on exit/end, not row crossings.
- Links resolve to ouvrages by unique code through src/lib/links.ts (target, dead/circular status, usages); store addLink/setLinkTarget refuse cycles — one rule set for tree, details and link dialog.

- Backups validate and confirm restores; PythonPart owns durable storage.
- VOB: single grouping; filters OR within/AND across fields. setFiles bypasses history; batch field edits use one snapshot and preserve other fields.

- Lazy managers and ATTRIBUTE_BY_NUMBER reduce startup work.
- Host I/O uses host-bridge envelopes; settings use app-settings sections. VOB saves acknowledge sent snapshots; refused commands never retry.
- VOB auto-widths stay local; only manual resize/fit saves sparse width overrides.
- VOB resource sessions retain per-path documents and undo history in memory; all file selections use vobSwitch to guard unsaved changes and serialize loading. Python owns versioned file lists and backup operations through host-bridge.
- Added VOB files use vob.files.add validation and the vobResources settings section; inventories merge by normalized full path so refresh never removes personal files. Native drops supply full paths, never browser-only filenames.
- VOB order uses vobEditor; fitting trims auto widths only; comments wrap, headings stay sticky.
- VOB projects are explicit; imports retain host classification. Shared version/filter helpers enforce visibility rules.
- VOB previews reuse VobRuleTree/display callbacks, ignoring editor filters/settings.
- VOB and SmartCatalog stores start empty: no demo data, invented versions or rebuilt Allplan paths; demo fixtures live only in src/test/fixtures.
- Protocol preparation uses unchanged release artifacts, generated types and original Draft 2020-12 validators plus semantic tests; keep it outside active imports. Future bindings use __allplanProtocolHost/__allplanProtocolClient.receive_message, allplan-protocol-host-ready (descriptor in detail) and pywebview.api.dispatch, never aliases or legacy-global replacement; bootstrap/handshake alone never select transport, authorize business dispatch or imply fallback.
- SmartCatalog/VOB startup uses suite/startup-target (explicit → last → managers; unknown access opens manager).

