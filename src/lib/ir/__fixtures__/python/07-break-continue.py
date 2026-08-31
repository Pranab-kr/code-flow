def first_even_after(xs, floor):
    for x in xs:
        if x <= floor:
            continue
        if x % 2 == 0:
            break
    return x
