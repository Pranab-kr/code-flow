int classify(int x) {
    int sign = 0;
    int scale = 0;
    if (x > 0) {
        sign = 1;
        scale = 10;
    } else {
        sign = -1;
        scale = 20;
    }
    return sign * scale;
}
