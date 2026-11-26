---
title: Markdown showcase
tags: [reference]
---

# Markdown showcase

Everything the editor renders, in one note. Move the cursor onto an element to see its source, or press `Ctrl+E` for source mode.

## Text

**Bold**, _italic_, ~~strikethrough~~, `inline code` and an [external link](https://example.com). A wikilink: [[Welcome]], one with a label: [[Deep Work|the focus book]], and one to a heading: [[Training plan#Pace]].

A plain `[[Ideas]]` link resolves to [[Ideas]] in the Knowmon project, because two notes share that name and the shorter path wins. Use [[Half marathon/Ideas]] to reach the other one.

> A quote. Tip: `Ctrl+click` a link to open it.

## Lists

- Item one
  - Nested item
    - Deeper item
- Item two

1. First
2. Second

- [x] A finished task
- [ ] An open task (click the box to toggle it)

---

## Table

| Left aligned | Centered | Right aligned |
| :----------- | :------: | ------------: |
| apples       |    3     |         $1.20 |
| `code`       | **bold** |   [[Welcome]] |
| a \| pipe    |    —     |          0.50 |

## Math

Inline: the pace formula $p = t / d$, and Euler's identity $e^{i\pi} + 1 = 0$. Prices like $5 and $10 stay plain text.

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## Code

```python
def pace(seconds: float, km: float) -> str:
    per_km = seconds / km
    return f"{int(per_km // 60)}:{int(per_km % 60):02d} /km"
```

## Image

![Knowmon logo](../attachments/knowmon-logo.png)
