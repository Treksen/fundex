# Phase 7 — Mobile transaction card: show BOTH refs

## Problem (from your screenshot)
On mobile, both refs were crammed onto one line under the member name, with `white-space: nowrap` + `text-overflow: ellipsis` on the parent. Result: `Dep: AB290F0305631 Bank: ✓` — the bank reference was truncated to literally one character.

## Fix
The refs are now **stacked on two independent lines** in the mobile card. Each line is its own row, so the bank code is fully visible regardless of how long either ref is.

```
[Avatar]  Amos Korir                          +Ksh 5,000.00
          Dep:  AB290F0305631
          Bank: ✓ FT26154YCN12          ← now fully visible
          deposit · completed · Approved & Verified
          04 Jun 2026, 11:04
```

- `Dep:` label is muted gray; the value uses monospaced text.
- `Bank:` label is muted gray; the value is monospaced + emerald green + bold, with the ✓ check.
- If a ref is genuinely longer than the card width (rare), it ellipsizes on its own line — the OTHER ref still shows in full.
- Hover/long-press shows the full value in a tooltip.

## Files
- `src/pages/TransactionsPage.jsx` — restructured the mobile card refs into stacked lines.
- `src/styles/main.css` — five new class rules: `mobile-tx-card-refs`, `mobile-tx-card-ref-line`, `mobile-tx-card-ref-label`, `mobile-tx-card-ref-value`, `mobile-tx-card-ref-bank`.

## Apply
Drop both files into your tree and redeploy. No DB migration. Desktop layout untouched.
