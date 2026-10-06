// 淺色（米白）／深色（Nord 風格）主題。顏色都定義在 main.css 的 CSS 變數，
// 這裡只負責記住使用者的選擇並設定 <html data-theme="...">。

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'knowmon.theme'

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** 讀取上次的主題；沒有紀錄或無法讀取時用淺色 */
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
    // 無法儲存時仍可切換，只是下次開啟會回到預設
  }
}

export function applyTheme(root: { dataset: DOMStringMap }, theme: Theme): void {
  root.dataset.theme = theme
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

/** localStorage 在某些情況下存取會丟例外，統一包起來 */
export function browserStore(): Store | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
