class SwitchForms {
    int colonForm(int v) {
        int r = 0;
        switch (v) {
            case 1:
                r = 1;
            case 2:
                r = 2;
                break;
            default:
                r = 9;
        }
        return r;
    }

    int arrowForm(int v) {
        int r = 0;
        switch (v) {
            case 1 -> r = 1;
            case 2 -> r = 2;
            default -> r = 9;
        }
        return r;
    }
}
