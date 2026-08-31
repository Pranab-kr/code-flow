import { Workbench } from '@/components/workbench/Workbench';

/**
 * Standalone demo: no auth, no persistence.
 *
 * Kept alongside the real /projects route because it is the fastest way to check
 * the parse → layout → canvas path without a database, and it is what the
 * marketing hero will embed (Plan 6).
 */
const STARTER = `def binary_search(arr, target):
    lo = 0
    hi = len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
`;

export const metadata = { title: 'Demo · code-flow' };

export default function DemoPage() {
  return <Workbench initialSource={STARTER} />;
}
