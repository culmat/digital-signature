# Contributing

Code quality principles shared by humans and agents. This is the single source of truth for how code should be written.

## Clean Code Principles

* **Single Responsibility:** Every function, class, and module must do only one thing.
* **DRY:** Avoid duplicating logic; reuse existing functions or abstractions where appropriate.
* **KISS:** Always choose the simplest solution that works.
* **YAGNI:** Do not implement features not explicitly required. Remove unused code whenever possible.
* **Short and Focused:** Keep files and functions as short as possible without losing clarity.
* **Meaningful Names:** All identifiers must clearly express intent and purpose.

## Code Style

* **Explicit Intent:** Code must be self-explanatory; minimize reliance on comments.
* **Minimal Comments:** Only explain *why*, never *how*.
* **Long Names Over Comments:** Prefer a parameter named `commaSeparatedFieldsToExpand` over `expand` with a comment.
* **No File-Level Comments:** Never add top-level file comments. The filename and code structure should make purpose clear. Files should start directly with imports/code.
* **No Redundant Comments:** Avoid comments that merely repeat what the code already says clearly.
* **No Dead Code:** Remove unused or redundant code.
* **Readable Flow:** Code must be structured clearly, like prose. Every line must serve a purpose.

## YAGNI in Practice

* No speculative abstractions or config for single values.
* No features not explicitly required by the current task.
* Scope limited to what's needed now, not what might be needed later.

## Test Guidelines (TDD)

* **Write tests first:** Always define expected behavior before generating implementation.
* **Tests as contracts:** Tests must fully describe expected behavior.
* **Keep tests simple:** Avoid complex or convoluted test logic.
* **Coverage over cleverness:** Focus on meaningful behavior, not quantity.

## Refactoring Guidelines

* **Boy scout rule:** Leave code cleaner than you found it, but only in files you're touching.
* **Separate commits:** Refactoring commits must be separate from behavior changes.
* **Tests before and after:** Ensure tests pass before refactoring and after.

