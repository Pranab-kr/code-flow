int countUp(int n) {
    int i = 0;
top:
    i = i + 1;
    if (i < n) {
        goto top;
    }
    return i;
}
