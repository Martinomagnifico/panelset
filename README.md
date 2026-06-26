# PanelSet

[![Version](https://img.shields.io/npm/v/panelset)]() [![Downloads](https://img.shields.io/npm/dt/panelset)]()

**Flexible panel management with smooth transitions.**

A small library for animating elements between sizes. Three classes share one animation core (a lock / measure / animate / unlock cycle): transitions are CSS only, JavaScript only measures and sets pixel values. Accessible by default (managed ARIA and focus), interrupt-safe, and it respects `prefers-reduced-motion`.

**Documentation:** the full guides, every option, and live examples are at <https://martinomagnifico.github.io/panelset/>. This README is a quick reference. 



## The three classes

| Class | What it does |
|---|---|
| **`Panel`** | A single element that opens and closes (accordions, show-more, sidebars, drawers). Animates `height` or `width`. |
| **`PanelSet`** | A container that switches between mutually exclusive panels (tabs, wizards, steppers). Animates its own height to fit the incoming panel. |
| **`PanelControl`** | Optional. Makes a tab strip or sidebar drive a `PanelSet`: keyboard navigation, roving `tabindex`, selection state (`aria-selected` on real tabs, `aria-current` otherwise), and tab locking through `setTabState()`. |

`PanelControl` is side-effect-free, so it tree-shakes out of the ESM build when you don’t import it.

## Installation

```bash
npm install panelset
```

```js
import { Panel, PanelSet, PanelControl } from 'panelset';
import 'panelset/style.css';
```

Or as a script tag (IIFE bundle):

```html
<link rel="stylesheet" href="panelset.css">
<script src="panelset.js"></script>
<!-- exposes window.Panel / PanelSet / PanelControl and registers
     <ps-panel> / <ps-panelset> / <ps-panelcontrol> -->
```

## Panel

Panels are **closed by default** (no class needed). Add `is-open` to start open.

```html
<button aria-controls="my-panel" aria-expanded="false">Toggle</button>

<div id="my-panel" data-panel>
  <div class="panel-wrapper">Content here</div>
</div>
```

```js
import { Panel } from 'panelset';
Panel.init();
```

Any `[aria-controls]` element is a trigger. As a shortcut, a `[data-panel-trigger]` button placed next to a panel (or as the direct child of a heading next to it) gets its `id` and ARIA set up automatically.

### Accordion (group)

```html
<div data-panel-group data-panel-close-siblings>
  <button aria-controls="acc-1" aria-expanded="false">Item 1</button>
  <div id="acc-1" data-panel><div class="panel-wrapper">Answer 1</div></div>

  <button aria-controls="acc-2" aria-expanded="false">Item 2</button>
  <div id="acc-2" data-panel><div class="panel-wrapper">Answer 2</div></div>
</div>
```

`data-panel-close-siblings` (or `closeSiblings: true`) makes opening one panel close the others.

### Panel options

| Option | Type | Default | Description |
|---|---|---|---|
| `align` | `'start' \| 'center' \| 'end'` | `'start'` | Content alignment within the clipped container |
| `autoFocus` | `false \| true \| 'heading' \| 'first' \| 'input'` | `false` | Move focus into the panel on open |
| `axis` | `'vertical' \| 'horizontal'` | `'vertical'` | Which dimension animates (height or width) |
| `closeOnResize` | `boolean` | `false` | Close the panel when the window is resized |
| `closeSiblings` | `boolean` | `false` | Close other open panels in the same group |
| `debug` | `boolean` | `false` | Log events to the console |
| `deepLink` | `boolean` | `false` | Reflect open state in the `?panel=` URL |
| `interruptible` | `boolean` | `true` | Allow a new open/close to interrupt one in progress |
| `loadingDelay` | `number` | `320` | ms before the spinner appears during async loading |
| `loadingHeight` | `number` | `150` | px reserved while async content loads |
| `persist` | `boolean` | `false` | Save open/closed state to `localStorage` |
| `returnFocus` | `boolean` | `true` | Return focus to the trigger on close |
| `transitions` | `boolean` | `true` | Enable/disable CSS transitions |

### Async content

```js
const panel = new Panel('#my-panel');

panel.onBeforeOpen((el, signal) => {
  return fetch('/api/content', { signal })
    .then(r => r.text())
    .then(html => { el.querySelector('.panel-wrapper').innerHTML = html; });
}, { once: true });
```

Or listen for the `panel:beforeopen` event and call `e.detail.waitUntil(promise)` to hold the open until it resolves.

## PanelSet

```html
<nav role="tablist" data-panelcontrol>
  <button role="tab" aria-controls="panel-1" aria-selected="true">Tab 1</button>
  <button role="tab" aria-controls="panel-2">Tab 2</button>
</nav>

<div data-panelset>
  <div class="panel-wrapper">
    <div id="panel-1" role="tabpanel" class="active">Content 1</div>
    <div id="panel-2" role="tabpanel" hidden>Content 2</div>
  </div>
</div>
```

```js
import { PanelSet, PanelControl } from 'panelset';
PanelSet.init();
PanelControl.init();   // keyboard navigation + state for the tab strip
```

Mark the starting panel with `class="active"` and every other panel `hidden`.

### PanelSet options

| Option | Type | Default | Description |
|---|---|---|---|
| `align` | `'start' \| 'center' \| 'end'` | `'start'` | Alignment while opening/closing |
| `autoFocus` | `false \| true \| 'heading' \| 'first' \| 'input'` | `false` | Move focus into the panel on activation |
| `closable` | `boolean` | `false` | Allow the whole container to open and close |
| `closeOnTab` | `boolean` | `false` | Clicking the active tab closes the container (needs `closable`) |
| `debug` | `boolean` | `false` | Log events to the console |
| `deepLink` | `boolean` | `false` | Reflect the active panel in the `?panel=` URL |
| `disabledMode` | `'aria' \| 'native'` | `'aria'` | How `data-ps-next` / `-prev` buttons are disabled at the ends |
| `interruptible` | `boolean` | `true` | Allow a new activation to interrupt one in progress |
| `levels` | `boolean` | `false` | Give panels a depth order from DOM position; forward/back slide opposite ways |
| `loadingDelay` | `number` | `320` | ms before the spinner appears during async loading |
| `loadingHeight` | `number` | `150` | px reserved while async content loads |
| `loop` | `boolean` | `false` | `next()` / `prev()` wrap around the ends |
| `manageLabels` | `boolean` | `true` | Link each panel to its tab via `aria-labelledby` (auto-generates a tab id if needed) |
| `manageTriggers` | `boolean` | `true` | Reflect selection (`aria-selected` on real tabs, `aria-current` otherwise) / activating state onto `[aria-controls]` triggers |
| `persist` | `boolean` | `false` | Save the active panel id to `localStorage` |
| `returnFocus` | `boolean` | `false` | Return focus to the trigger on close |
| `transitions` | `boolean \| { panels?: boolean, height?: boolean }` | `true` | Enable/disable transitions (or per axis) |

### Async content

```js
const ps = new PanelSet('#my-panelset');

ps.onBeforeOpen((targetPanel, signal) => {
  return fetch(`/api/${targetPanel.id}`, { signal })
    .then(r => r.json())
    .then(data => { targetPanel.innerHTML = render(data); });
}, { once: true });
```

## PanelControl

Drives one `PanelSet` from its trigger elements, so you do not hand-write the tab interaction. Put `data-panelcontrol` on the container; add `role="tablist"` (with `role="tab"` buttons) to switch on the keyboard model (arrow keys, `Home` / `End`, roving `tabindex`). It finds its `PanelSet` through the panels the triggers point at, so the control can live anywhere in the DOM.

Lock or unlock a tab from your own code:

```js
control.setTabState('panel-3', 'disabled');  // lock
control.setTabState('panel-3', 'enabled');   // unlock
```

| Option | Type | Default | Description |
|---|---|---|---|
| `activation` | `'manual' \| 'auto'` | `'manual'` | `manual`: arrows move focus, Enter/Space/click activates. `auto`: arrows activate too. |
| `debug` | `boolean` | `false` | Log to the console |

## Configuration sources

Every option can also be set as a **data attribute** in the markup, or as a plain attribute on the **web component**. When the same option is set more than once, the most specific wins: **defaults -> JS options -> data attribute**. The exact attribute names are listed per option in the docs.

## Web components

`register()` defines `<ps-panel>`, `<ps-panelset>`, and `<ps-panelcontrol>` (the script-tag build calls it for you). On the elements, options are plain attributes, no `data-` prefix.

```js
import { register } from 'panelset';
register();            // default 'ps' prefix
register('acme');      // <acme-panel>, <acme-panelset>, <acme-panelcontrol>
```

## CSS

Timing and sizing are CSS custom properties, set on the element or any ancestor (all timing values need a unit, e.g. `0.25s` not `0`). For example, on a Panel:

```css
[data-panel] {
  --ps-open-speed:   0.25s;
  --ps-open-timing:  ease-in-out;
  --ps-close-speed:  0.25s;
  --ps-close-timing: ease-in-out;
}
```

`PanelSet` exposes a similar set for its fade and height timing. See the docs for the full list.

## Support

PanelSet is free and open source. If it saves you time, consider [sponsoring my work](https://ko-fi.com/martinomagnifico).

## License

MIT © [Martinomagnifico](https://github.com/martinomagnifico)
