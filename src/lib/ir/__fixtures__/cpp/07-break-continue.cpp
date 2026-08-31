int firstEvenAfter(const std::vector<int>& xs, int floor) {
    int found = -1;
    for (int x : xs) {
        if (x <= floor) {
            continue;
        }
        if (x % 2 == 0) {
            found = x;
            break;
        }
    }
    return found;
}
