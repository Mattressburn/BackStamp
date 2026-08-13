BLUF: No code changed. The current tree contains no unprompted navigation reachable from Scan, so adding a guard would be speculative.

Root cause: Not established. All three Scan navigation calls are press-only handlers. Scan effects only load data, drain the offline queue, refresh permission, or change phases. Result-screen effects only animate. `AppTabs` contains no redirect or hide/show condition. The closest confirmed structural issue is that native tabs register only three routes while item details are pushed outside that set. Expo documents that native-tab routes must be explicitly registered and pushed detail screens require a nested Stack, but this does not prove the reported automatic navigation. [Expo Native Tabs guide](https://docs.expo.dev/router/advanced/native-tabs/), [navigator nesting guide](https://docs.expo.dev/router/advanced/nesting-navigators/).

Navigation trace:

- [scan-screen.tsx:1291](/home/mattressburrn/Documents/Projects/PyDex/app/src/features/scan/scan-screen.tsx:1291): opens an item card only from the “Just open the card” press while the owned sheet is rendered.
- [scan-screen.tsx:1492](/home/mattressburrn/Documents/Projects/PyDex/app/src/features/scan/scan-screen.tsx:1492): opens an item card only from a photo-invite row press while the saved phase is rendered.
- [scan-screen.tsx:1500](/home/mattressburrn/Documents/Projects/PyDex/app/src/features/scan/scan-screen.tsx:1500): opens Collection only from the “See my file” press.
- No `router.replace()` or `router.back()` exists in the Scan files.
- Downstream item-detail back calls and Collection navigation calls are also button or row presses.

Changed lines: 0. The owned-file diff is empty.

Verification:

- `cd app && npx tsc --noEmit`: passed.
- `cd app && node --import tsx --test "src/**/*.test.ts"`: 4 passed, 0 failed.

These checks validate the current tree, not the physical-phone symptom. A device navigation trace is required before a causal fix can be made.