int describe(int v) {
    int r = 0;
    switch (v) {
        case 1:
            r = 1;
        case 2:
            r = 2;
            break;
        case 3:
            r = 3;
            break;
        default:
            r = 9;
    }
    return r;
}
