int find(const std::vector<int>& xs, int target) {
    int found = -1;
    for (int i = 0; i < (int)xs.size(); i++) {
        if (xs[i] == target) {
            found = i;
            break;
        }
    }
    if (found < 0) {
        return -1;
    }
    return found;
}
