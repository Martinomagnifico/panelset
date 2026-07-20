# Changelog

## [1.2.7] - 2026-07-20

### Fixed
- PanelSet now correctly uses loadingDelay, matching Panel.
- Spinner fade no longer derived from --ps-loading-panel-opacity, which could zero it.
- Removed --ps-loading-fadeout-duration, which never did anything.
- Spinner no longer slides while a Panel opens.

### Added
- --ps-spinner-fade-in-speed, --ps-spinner-fade-out-speed.



## [1.2.6] - 2026-07-17

### Added
- Custom loading indicators. While a panel loads async content, the trigger that opened it (a button or tab) now also gets `aria-busy="true"` and an `.is-trigger-loading` class, so you can show a spinner in the control, not only in the panel.

### Changed
- Build now ships one ES module per source file (under `dist/esm/`) instead of a single flattened bundle, so `import { Panel }` tree-shakes away PanelSet and PanelControl. The IIFE (`dist/panelset.js`), the stylesheet, and the `panelset` / `panelset/register` import paths are unchanged; only the internal ESM layout moved.



## [1.2.5] - 2026-07-12

### Changed
- The `data-ps-for="<panel-id>"` attributes now swaps with the aria-controls.
- Changed static example so that it works on smaller devices.



## [1.2.4] - 2026-07-12

### Changed
A static Panel now takes **`aria-controls`** off its trigger as well as `aria-expanded`. Panel then uses a **`data-ps-for="<panel-id>"`** so that the trigger can be found again.



## [1.2.3] - 2026-07-11

### Added
- Panel `static` option (`boolean | media query`, default `false`): make a panel plain expanded content instead of a collapsible disclosure.

### Fixed
- A closed panel’s hand-authored `[aria-controls]` trigger now gets `aria-expanded="false"` on init.



## [1.2.2] - 2026-07-10

### Added
- `--ps-gpu-nudge` CSS variable that keeps Panel and PanelSet transitions smooth on iOS Safari, where an animating SVG icon (like a rotating chevron) can otherwise make a transition stutter. It applies an invisible GPU-compositing nudge only while animating.



## [1.2.1] - 2026-06-26

### Fixed
- Accessibility: use `aria-current` instead of `aria-selected` on non-tab triggers.



## [1.2.0] - 2026-06-22

### Added
- PanelControl: a tablist controller with keyboard navigation
- Web component versions
- Navigation on PanelSet: `next()`, `prev()` etc
- `addPanel()` and `removePanel()`
- `refresh()`
- Verb buttons wired by delegation: `data-ps-next`, `data-ps-prev`, `data-ps-close`.
- Lifecycle events
- Async content loading



## [1.0.9] - 2026-04-10

### Added
- Added Panel
- New documentation
- Added destroy() method
- Added data-panel-trigger implicit wiring (auto ID assignment)

### Fixed
- Fixed mid-close reversal bug (smooth re-open from mid-animation)
- Fixed focus jump when closeSiblings closes a sibling

### Removed
- Removed Core.measure()



## [1.0.8] - 2026-02-18

### Changed
- Removed aria-selected.



## [1.0.7] - 2026-02-18

### Changed
- Add data-attribute for autoFocus. This will override show() or global autoFocus settings.



## [1.0.6] - 2026-02-18

### Added
- Added short delay in autoFocus



## [1.0.5] - 2026-02-18

### Added
- Added 'input' case in autoFocus with keyboard detection bypass



## [1.0.4] - 2026-02-18

### Added
- Added automatic `aria-selected` management for tab interfaces
  - Automatically sets `aria-selected="true"` on active tabs with `role="tab"`
  - Automatically sets `aria-selected="false"` on all other tabs in the same tablist
  - Syncs on both `show()` calls and during initialization
  - No configuration needed - activates automatically when `role="tab"` is detected



## [1.0.3] - 2026-02-16

### Changed
- Changed API to make it more flexible.



## [1.0.1] - 2026-02-16

### Changed
- Changed API to include event.



## [1.0.0] - 2026-02-13

### Changed
- Stable version 1. Docs will still follow.

### Added
- Added autofocus


## [0.5.4] - 2026-02-11

### Changed
- Added warning if no panels found



## [0.5.3] - 2026-02-08

### Added
- Added height tracking



## [0.5.2] - 2026-01-06

### Changed
- Added default export
- Added warning if selector does not have the data-tabs attribute
- Wrote more docs (will follow)



## [0.5.0] - 2026-01-04
- First commit
