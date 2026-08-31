class MultiReturn {
    int boundsCheck(int[] arr, int i) {
        if (i < 0) {
            return -1;
        }
        if (i >= arr.length) {
            return -2;
        }
        return arr[i];
    }
}
