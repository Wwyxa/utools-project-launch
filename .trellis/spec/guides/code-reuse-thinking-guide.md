# Code Reuse

Search the owning feature before adding a helper, component, or constant.
Prefer extending an existing implementation when behavior and ownership match.

- Keep feature-specific code local. Extract shared code when it removes real
  duplication or owns a reusable lifecycle, not merely to shorten a file.
- Similar output does not prove identical contracts. Preserve intentional
  differences between browser fallback, preload, and service implementations.
- When changing a shared contract, update its types, producer, consumers, and
  focused tests together. Search for old symbols/paths after moving code.
- Remove unused locale keys in both languages when the associated UI disappears.

Specs retain stable project contracts and source/test pointers. Do not append
task narratives, copied implementations, generic advice, or a new rule for every
bug. Update the owning rule and remove superseded or duplicate wording.
