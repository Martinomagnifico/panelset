# PanelSet

**Flexible panel management with smooth transitions**

A TypeScript/SCSS library for animating elements between sizes. Two classes — one for a single collapsible panel, one for switching between mutually exclusive panels — both built on the same lock-measure-animate-unlock cycle.

## Support
   PanelSet is free and open source. If it saves you time, consider [sponsoring my work](https://ko-fi.com/martinomagnifico)

---

## Classes

### `Panel`

A single element that opens and closes. Use it for accordions, show-more blocks, sidebars, or any collapsible element. Triggers are any `[aria-controls]` element pointing to the panel's ID.

### `PanelSet`

A container that switches between mutually exclusive panels. Use it for tabs or wizard interfaces. The container animates its own height to match the incoming panel.

---

## Installation

```bash
npm install panelset
```

```js
import { Panel, PanelSet } from 'panelset';
import 'panelset/style.css';
```

Or via CDN (IIFE):

```html
<script src="panelset.js"></script>
```

---

## Panel, quick start

```html
<button aria-controls="my-panel" aria-expanded="false">Toggle</button>

<div id="my-panel" data-panel class="is-closed">
  <div class="panel-wrapper">
    Content here
  </div>
</div>
```

```js
import { Panel } from 'panelset';
Panel.init();
```

### Accordion (group)

```html
<div data-panel-group data-panel-close-siblings>
  <button aria-controls="acc-1" aria-expanded="false">Item 1</button>
  <div id="acc-1" data-panel class="is-closed">
    <div class="panel-wrapper">Answer 1</div>
  </div>

  <button aria-controls="acc-2" aria-expanded="false">Item 2</button>
  <div id="acc-2" data-panel class="is-closed">
    <div class="panel-wrapper">Answer 2</div>
  </div>
</div>
```

`data-panel-group` scopes the group. `data-panel-close-siblings` (or `closeSiblings: true`) makes opening one panel close the others.

### Panel options

| Option | Type | Default | Description |
|---|---|---|---|
| `axis` | `'vertical' \| 'horizontal'` | `'vertical'` | Which dimension animates |
| `align` | `'start' \| 'center' \| 'end'` | `'start'` | Content alignment within the clipped container |
| `transitions` | `boolean` | `true` | Enable/disable CSS transitions |
| `autoFocus` | `false \| true \| 'heading' \| 'first' \| 'input'` | `false` | Move focus into the panel on open |
| `returnFocus` | `boolean` | `true` | Return focus to the trigger on close |
| `closeSiblings` | `boolean` | `false` | Close other open panels in the same group |
| `closeOnResize` | `boolean` | `false` | Close the panel when the window is resized |
| `interruptible` | `boolean` | `true` | Allow a new open/close to interrupt an animation in progress |
| `persist` | `boolean` | `false` | Save open/closed state to localStorage |
| `deepLink` | `boolean` | `false` | Update the `?panel=` URL param on open/close |
| `loadingDelay` | `number` | `300` | ms before spinner appears during async loading |
| `loadingHeight` | `number` | `80` | px height while async content loads |
| `debug` | `boolean` | `false` | Log events to the console |

All options are also available as data attributes, e.g. `data-panel-axis="horizontal"`.

### Async content (Panel)

```js
const panel = new Panel('#my-panel');

panel.onBeforeOpen((el, signal) => {
  return fetch('/api/content', { signal })
    .then(r => r.text())
    .then(html => {
      el.querySelector('.panel-wrapper').innerHTML = html;
    });
}, { once: true });
```

---

## PanelSet, quick start

```html
<button aria-controls="panel-1">Tab 1</button>
<button aria-controls="panel-2">Tab 2</button>

<div data-panelset>
  <div class="panel-wrapper">
    <div id="panel-1" role="tabpanel" class="active">Content 1</div>
    <div id="panel-2" role="tabpanel" hidden>Content 2</div>
  </div>
</div>
```

```js
import { PanelSet } from 'panelset';
PanelSet.init();

document.addEventListener('click', e => {
  const btn = e.target.closest('button[aria-controls]');
  if (!btn) return;
  const id = btn.getAttribute('aria-controls');
  document.getElementById(id)?.closest('[data-panelset]')?.panelSet?.show(id, { event: e });
});
```

### PanelSet options

| Option | Type | Default | Description |
|---|---|---|---|
| `align` | `'start' \| 'center' \| 'end'` | `'start'` | Container alignment |
| `transitions` | `boolean \| { panels?: boolean, height?: boolean }` | `true` | Enable/disable transitions independently |
| `closable` | `boolean` | `false` | Allow the container to be fully closed |
| `closeOnTab` | `boolean` | `false` | Clicking the active tab closes the container |
| `autoFocus` | `false \| true \| 'heading' \| 'first' \| 'input'` | `false` | Move focus into the panel on activation |
| `returnFocus` | `boolean` | `false` | Return focus to the trigger on close |
| `interruptible` | `boolean` | `true` | Allow a new activation to interrupt one in progress |
| `manageTriggers` | `boolean` | `true` | Let PanelSet update `aria-selected` and trigger state |
| `persist` | `boolean` | `false` | Save the active panel ID to localStorage |
| `deepLink` | `boolean` | `false` | Update the `?panel=` URL param on activation |
| `loadingDelay` | `number` | `300` | ms before spinner appears during async loading |
| `loadingHeight` | `number` | `200` | px height while async content loads |
| `debug` | `boolean` | `false` | Log events to the console |

### Async content (PanelSet)

```js
const ps = new PanelSet('#my-panelset');

ps.onBeforeOpen((targetPanel, signal) => {
  return fetch(`/api/${targetPanel.id}`, { signal })
    .then(r => r.json())
    .then(data => {
      targetPanel.innerHTML = render(data);
    });
}, { once: true });
```

---

## CSS variables

### Panel

```css
[data-panel] {
  --ps-open-speed:          0.25s;
  --ps-open-timing:         ease-in-out;
  --ps-close-speed:         0.25s;
  --ps-close-timing:        ease-in-out;
  --ps-panel-width:         320px;  /* horizontal panels */
  --ps-closed-opacity:      0;      /* set to 1 to keep content visible while closed */
}
```

### PanelSet

```css
[data-panelset] {
  --ps-fadeout-speed:         0.125s;
  --ps-fadeout-timing:        ease-in;
  --ps-fadein-speed:          0.125s;
  --ps-fadein-timing:         ease-in-out;
  --ps-fadein-delay:          0.125s;
  --ps-height-duration-ratio: 1;
  --ps-transition-timing:     ease-in-out;
  --ps-open-speed:            0.25s;
  --ps-open-timing:           ease-in-out;
  --ps-close-speed:           0.25s;
  --ps-close-timing:          ease-in-out;
}
```

---

## License

MIT © [Martinomagnifico](https://github.com/Martinomagnifico)
