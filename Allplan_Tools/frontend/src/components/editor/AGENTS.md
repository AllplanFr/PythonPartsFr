## Editor components
- Attribute panel container queries stack narrow rows; checkbox grids wrap identically in layer/fill controls to keep every choice inside the value field.
- Node icons render through NodeIcon.tsx, sharing artwork with the toolbar — keeps tree and ribbon consistent.
- FolderIconPicker shares a personal icon library across tree/details; assignments use catalog history, usage statistics do not.
- AppTooltips upgrades native title hints globally to the manager style; rich manager hints retain their title and description.
- Formula object and trade selectors share ReferenceDialog so search, selection, sorting and insertion stay consistent.
- StickyTreeParents uses a zero-height native sticky wrapper and opaque overlay, preventing scroll-refresh flashes without shifting virtual row/drop coordinates.
- The catalog renders the layer bundle through standard Row controls; LineStyleField hides inherited manual rows independently while retaining stored values. LayerAttributeField offers completion and a separate hierarchical browser, keeping each integer value independent.
- FillAttributeRows uses standard catalog Row controls for type-dependent rows; FillAttributeField shares choices with models/external sources and keeps the style browser separate from completion.
- CustomToolbar reconciles current button IDs to remove obsolete actions and add new ones while preserving personal layouts.
- Dialog's optional header slot embeds independent editor controls without losing bounded movement/resizing.

- Layer/fill stripes are assigned during rendering, never by scanning mounted rows.
- VOB edits commit on validation; comparison display preserves negative operands and stored formulas.
- VOB comment translation opens Google Translate only on explicit click.
- MenuFlag shares bundled country artwork across language and VOB file menus; file territory precedes extension language to preserve regional variants.
- VOB About uses a dedicated controlled Dialog so its exit animation completes independently of the shared message queue; animations honor reduced motion.

- Standalone formula editors supply an explicit favorite callback; never fall back to catalog selection. VOB mounts and hydrates the shared favorite manager.
- HistLabel labels undo/redo entries for multi-step title-bar history menus.
- VOB header reordering uses pointer events across the entire heading, excluding resize handles, so pywebview does not depend on native HTML drag support; settings keep the same order contract.
- QuickActionTooltip shares interactive summaries and explicit actions; VobRowHover adapts VOB icons and targets the hovered rule independently of selection.
- VOB Quit delegates to its module's capability-gated event coordinator and shared all-file leave policy; an older native host keeps the editor accessible with an explicit unavailable notice, never window.close or home navigation.

- VOB category presentation and trade-label sorting live in the shared rule tree/grouping helper, keeping preview and selection order aligned without altering file order; native data version uses the unfiltered host context, not manager filters.
