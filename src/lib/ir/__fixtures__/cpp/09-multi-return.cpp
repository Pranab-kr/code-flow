int boundsCheck(const std::vector<int>& arr, int i) {
    if (i < 0) {
        return -1;
    }
    if (i >= (int)arr.size()) {
        return -2;
    }
    return arr[i];
}
