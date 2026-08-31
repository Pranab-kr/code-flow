class TryFinally {
    int readCount(String path) {
        Reader handle = null;
        try {
            handle = open(path);
            return countBytes(handle);
        } catch (IOException e) {
            return 0;
        } finally {
            if (handle != null) {
                handle.close();
            }
        }
    }
}
