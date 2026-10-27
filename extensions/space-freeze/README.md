# Space Freeze

Locks the address of tabs you pin into a Zen space. A normal link:

```html
<a href="https://example.com">Opens in the same tab</a>
```

is rewritten, while that tab stays pinned, to:

```html
<a href="https://example.com" target="_blank" rel="noopener noreferrer">Opens in a new tab</a>
```

Form submits, `location` changes, and `history.pushState` / `replaceState` open a new unpinned tab instead of changing the pinned one. Zen places that new tab in the general tab list. Reloading the pinned tab, and editing its URL from the address bar, still updates the pin.

Essentials are pinned too, so they follow the same rule until you uncheck them.

## Install in Zen

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Choose `extensions/space-freeze/manifest.json`.

A temporary add-on unloads when Zen quits. Load it again after a restart. The toolbar button opens the switches: one for each space profile, and one for each pinned tab.

Spaces that use the default profile share the **Default profile** switch. Give a space its own profile (the space’s Profile setting) when it needs its own switch.
