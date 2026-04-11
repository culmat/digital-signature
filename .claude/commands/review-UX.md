# Review Forge UI Kit Best Practices

You are a Forge UI Kit expert reviewing this codebase for compliance with Atlassian UI Kit best practices. Produce a structured findings report.

## Setup

Before reviewing, load the latest Forge UI Kit guidance:

1. Call `mcp__forge__forge-ui-kit-developer-guide` to get the full UI Kit developer guide
2. Call `mcp__forge__atlassian-design-tokens` to get the design token reference
3. Read `AGENTS.md` for the list of allowed UI Kit components and project conventions

Then read all frontend files:

- `src/frontend/*.jsx`
- `src/frontend/**/*.jsx`

Note: the main frontend surfaces are the signature macro (`index.jsx`), macro configuration panel (`config.jsx`), and admin panel (`admin.jsx`).

## Check categories

Run each check below. For each finding, record: `{file, line, severity, category, message}`.

### 1. Component compliance (severity: error)

- Any HTML elements (`<div>`, `<span>`, `<strong>`, `<button>`, `<a>`, `<img>`, `<table>`, `<ul>`, `<li>`, etc.) — must be zero
- Any imports from deprecated `@forge/ui` — must be zero
- Any hardcoded hex/rgb colors or inline `style` props — must be zero; all styling via `xcss()`
- Any `className` usage — not supported in UI Kit

### 2. Structural patterns (severity: error)

- **Tabs**: verify `Tabs(id)` > `TabList` > `Tab` (text only, no props) + sibling `TabPanel`
- **Label/labelFor**: every `Textfield`, `TextArea`, `Select`, `Toggle` must have a corresponding `<Label labelFor="...">` with matching ID
- **Empty components**: `<Text></Text>`, `<Box></Box>`, `<Stack></Stack>`, `<Inline></Inline>` with no children
- **Heading**: must use `size` prop, never deprecated `level`

### 3. Defensive coding (severity: warning)

- Unguarded `.map()`, `.filter()`, `.includes()` on potentially undefined arrays — should use `(arr || [])` pattern
- Missing error handling on `invoke()` calls
- Missing loading states (should show `<Spinner />` while data loads)

### 4. Form patterns (severity: warning)

- Modals with multiple input fields managed by raw `useState` + manual update — suggest `Form` component
- Submit buttons outside a `<Form>` component
- Missing `ErrorMessage`/`HelperMessage`/`ValidMessage` for validation feedback
- Required fields without `RequiredAsterisk` component

### 5. Component opportunities (severity: info)

- Empty tables/lists without `EmptyState` component
- Multiple categorical labels displayed as plain text instead of `Tag`/`TagGroup`
- Icon-only buttons or truncated text without `Tooltip`
- Callbacks in `.map()` loops without `useCallback`/`useMemo`

### 6. Code quality (severity: info)

- Identical functions defined in multiple files (duplication)
- Similar JSX blocks across files that could be extracted into shared components
- Inline `xcss()` calls that recreate styles on every render (should be extracted to module scope)

### 7. i18n completeness (severity: warning)

- Hardcoded English strings in JSX not wrapped in `t()` translation calls
- Missing translation keys referenced in code but absent from translation files
- Check `src/i18n/` for completeness across supported languages

### 8. Design tokens (severity: info)

- Verify `xcss()` uses semantic tokens where appropriate (e.g., `color.background.information` for info sections, `elevation.surface.raised` for card-like elements)
- Check spacing consistency — prefer design token spacing (`space.100`, etc.) over arbitrary values

## Output format

Produce a Markdown report with this structure:

```
## Forge UI Kit Review — {date}

### Summary
- Errors: {count}
- Warnings: {count}
- Info: {count}

### Errors
#### {file}
- **Line {n}** [{category}]: {message}

### Warnings
#### {file}
- **Line {n}** [{category}]: {message}

### Info / Opportunities
#### {file}
- **Line {n}** [{category}]: {message}

### Recommendations
{Prioritized list of suggested improvements with estimated effort}
```

Be context-aware: if a `.map()` is inside a conditional that already guards the array, do NOT flag it. Only flag genuinely unguarded cases.

## Apply changes

After completing the review, implement all fixes from the "Errors" and "Warnings" sections. Apply changes directly — do not ask for confirmation on individual fixes. Run `npx vitest run` after all changes to verify nothing is broken.
