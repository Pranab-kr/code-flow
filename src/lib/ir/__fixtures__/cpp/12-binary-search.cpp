int binarySearch(const std::vector<int>& arr, int target) {
    int lo = 0;
    int hi = (int)arr.size() - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (arr[mid] == target) {
            return mid;
        } else if (arr[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return -1;
}
