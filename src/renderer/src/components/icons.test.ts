import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as icons from './icons'
import type { IconProps } from './icons'

const render = (C: FunctionComponent<IconProps>, props: IconProps = {}): string =>
  renderToStaticMarkup(createElement(C, props))

const lineIcons = Object.entries(icons).filter(
  ([name]) => name.endsWith('Icon') && name !== 'SidebarIcon'
) as [string, FunctionComponent<IconProps>][]

describe('line icons', () => {
  it('exports the icons the UI uses', () => {
    expect(lineIcons.length).toBeGreaterThanOrEqual(18)
  })

  it.each(lineIcons)('%s is decorative, uses currentColor and defaults to 18px', (_, C) => {
    const html = render(C)
    expect(html).toMatch(/^<svg /)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('stroke="currentColor"')
    expect(html).toContain('width="18"')
    expect(html).toContain('viewBox="0 0 24 24"')
  })

  it('honours size and className', () => {
    const html = render(icons.SearchIcon, { size: 14, className: 'x' })
    expect(html).toContain('width="14"')
    expect(html).toContain('height="14"')
    expect(html).toContain('class="x"')
  })

  it('draws the sidebar divider on the requested side', () => {
    const left = renderToStaticMarkup(createElement(icons.SidebarIcon, { side: 'left' }))
    const right = renderToStaticMarkup(createElement(icons.SidebarIcon, { side: 'right' }))
    expect(left).toContain('M9 4v16')
    expect(right).toContain('M15 4v16')
  })
})

describe('Logo', () => {
  it('is an accessible image named Knowmon', () => {
    const html = render(icons.Logo, { size: 96 })
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Knowmon"')
    expect(html).toContain('width="96"')
    expect(html).not.toContain('aria-hidden')
  })
})
