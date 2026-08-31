import { Workbench } from './Workbench';

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

export default function DemoPage() {
  return <Workbench initialSource={STARTER} />;
}
