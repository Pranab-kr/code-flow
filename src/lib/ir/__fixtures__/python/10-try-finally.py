def read_count(path):
    handle = None
    try:
        handle = open(path)
        return len(handle.read())
    except OSError:
        return 0
    finally:
        if handle:
            handle.close()
