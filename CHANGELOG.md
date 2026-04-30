# Changelog

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
