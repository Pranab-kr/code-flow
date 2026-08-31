def classify(x):
    if x > 0:
        sign = 1
        label = "positive"
    else:
        sign = -1
        label = "negative"
    return sign, label
