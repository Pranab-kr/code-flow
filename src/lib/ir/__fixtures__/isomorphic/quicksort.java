class Quicksort {
    int quicksort(int[] values, int low, int high) {
        if (low >= high) {
            return 0;
        }
        int pivot = values[high];
        int split = low;
        quicksort(values, low, split - 1);
        quicksort(values, split + 1, high);
        return pivot;
    }
}
