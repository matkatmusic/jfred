from inventory import qty_chk, tot_value, _make_item


class TestQtyChk:
    def test_available(self):
        item = _make_item("A", 1.0, 10)
        assert qty_chk(item, 10)

    def test_under(self):
        item = _make_item("A", 1.0, 10)
        assert qty_chk(item, 5)

    def test_over(self):
        item = _make_item("A", 1.0, 10)
        assert not qty_chk(item, 11)

    def test_zero(self):
        item = _make_item("A", 1.0, 0)
        assert qty_chk(item, 0)
        assert not qty_chk(item, 1)


class TestTotValue:
    def test_empty(self):
        assert tot_value([]) == 0

    def test_single(self):
        store = [_make_item("A", 5.0, 3)]
        assert tot_value(store) == 15.0

    def test_multiple(self):
        store = [
            _make_item("A", 10.0, 2),
            _make_item("B", 3.50, 4),
        ]
        assert tot_value(store) == 34.0

    def test_zero_stock(self):
        store = [_make_item("A", 99.99, 0)]
        assert tot_value(store) == 0.0
