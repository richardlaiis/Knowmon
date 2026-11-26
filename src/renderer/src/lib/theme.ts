// Light (off-white) and dark (Nord-style) themes. All colors are CSS variables defined in main.css;
// this only remembers the user's choice and sets <html data-theme="...">.

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'knowmon.theme'

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** Reads the last theme; light when there's no record or it can't be read */
export function loadTheme(store: Store | null): Theme {
  try {
    return store?.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function saveTheme(store: Store | null, theme: Theme): void {
  try {
    store?.setItem(THEME_KEY, theme)
  } catch {
    // Switching still works when it can't be saved; it just returns to the default next time
  }
}

export function applyTheme(root: { dataset: DOMStringMap }, theme: Theme): void {
  root.dataset.theme = theme
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

/** Accessing localStorage throws in some situations, so wrap it */
export function browserStore(): Store | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
