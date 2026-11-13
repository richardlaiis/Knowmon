// 介面圖示：全部手寫 inline SVG（24×24、線條、currentColor），不加圖示套件
import type { ReactNode } from 'react'

export interface IconProps {
  /** 像素大小，預設 18 */
  size?: number
  className?: string
}

function Icon({
  size = 18,
  className,
  children
}: IconProps & { children: ReactNode }): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const NOTE_OUTLINE = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'
const FOLDER_OUTLINE = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'

export function NoteIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d={NOTE_OUTLINE} />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Icon>
  )
}

export function NewNoteIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d={NOTE_OUTLINE} />
      <path d="M14 3v5h5M12 11v6M9 14h6" />
    </Icon>
  )
}

export function FolderIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d={FOLDER_OUTLINE} />
    </Icon>
  )
}

export function FolderOpenIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 17V7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" />
      <path d="M3 17l2.4-6a1.6 1.6 0 0 1 1.5-1H20a1 1 0 0 1 .95 1.3L19 18a1.6 1.6 0 0 1-1.5 1H5a2 2 0 0 1-2-2z" />
    </Icon>
  )
}

export function NewFolderIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d={FOLDER_OUTLINE} />
      <path d="M12 10v6M9 13h6" />
    </Icon>
  )
}

export function FilesIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M16 3H9a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6z" />
      <path d="M16 3v3h3M4 8v11a2 2 0 0 0 2 2h8" />
    </Icon>
  )
}

export function SearchIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </Icon>
  )
}

export function GraphIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="11" cy="18" r="2.5" />
      <path d="M8.5 6.4l7 1.2M7 8.3l3 7.4M16.6 10.1l-4.2 5.8" />
    </Icon>
  )
}

export function LocalGraphIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="20" r="2" />
      <path d="M10.1 10.4L6.5 7.3M13.9 10.4l3.6-3.1M12 14.5V18" />
    </Icon>
  )
}

export function TimelineIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 12h18M8 5v3.5M16 15.5V19" />
      <circle cx="8" cy="12" r="2.2" fill="currentColor" />
      <circle cx="16" cy="12" r="2.2" fill="currentColor" />
    </Icon>
  )
}

export function GoToIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M7 17L17 7M8 7h9v9" />
    </Icon>
  )
}

export function BacklinksIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
    </Icon>
  )
}

export function SparkleIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z" />
      <path d="M19 15v5M16.5 17.5h5" />
    </Icon>
  )
}

export function SettingsIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M18.88 9.87L21.36 10.39V13.61L18.88 14.13L18.37 15.36L19.76 17.48L17.48 19.76L15.36 18.37L14.13 18.88L13.61 21.36H10.39L9.87 18.88L8.64 18.37L6.52 19.76L4.24 17.48L5.63 15.36L5.12 14.13L2.64 13.61V10.39L5.12 9.87L5.63 8.64L4.24 6.52L6.52 4.24L8.64 5.63L9.87 5.12L10.39 2.64H13.61L14.13 5.12L15.36 5.63L17.48 4.24L19.76 6.52L18.37 8.64Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  )
}

export function ChevronIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M9 6l6 6-6 6" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function MoonIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Icon>
  )
}

export function SunIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  )
}

export function SidebarIcon({
  side,
  ...props
}: IconProps & { side: 'left' | 'right' }): React.JSX.Element {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d={side === 'left' ? 'M9 4v16' : 'M15 4v16'} />
    </Icon>
  )
}

/**
 * Knowmon Logo：節點連成的 K（筆記圖譜），外圈虛線點代表時間脈絡。
 * 與 build/icon.svg 同一個圖形（這裡用單色底，不用漸層，避免多個實例的 id 衝突）。
 * 顏色固定，不跟主題變。
 */
export function Logo({ size = 32, className }: IconProps): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="32 32 448 448"
      role="img"
      aria-label="Knowmon"
    >
      <rect x="32" y="32" width="448" height="448" rx="104" fill="#232834" />
      <circle
        cx="256"
        cy="256"
        r="150"
        fill="none"
        stroke="#88c0d0"
        strokeOpacity="0.45"
        strokeWidth="16"
        strokeLinecap="round"
        strokeDasharray="0.01 33.6499"
      />
      <path
        d="M196 160v192M196 262l104-102M234 226l70 126"
        fill="none"
        stroke="#eceff4"
        strokeWidth="24"
        strokeLinecap="round"
      />
      <circle cx="196" cy="160" r="26" fill="#eceff4" />
      <circle cx="196" cy="352" r="26" fill="#eceff4" />
      <circle cx="300" cy="160" r="26" fill="#88c0d0" />
      <circle cx="304" cy="352" r="26" fill="#b48ead" />
    </svg>
  )
}
