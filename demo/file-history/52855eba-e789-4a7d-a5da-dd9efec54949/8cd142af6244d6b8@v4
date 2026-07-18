from inventory import qty_chk, tot_value, reserve, find_item, _make_item, add_item


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


class TestReserve:
    def test_reserve_reduces_available(self):
        store = [_make_item("W", 5.0, 10)]
        reserve(store, "W", 3)
        assert find_item(store, "W")["reserved"] == 3

    def test_reserve_twice_accumulates(self):
        store = [_make_item("W", 5.0, 10)]
        reserve(store, "W", 3)
        reserve(store, "W", 4)
        assert find_item(store, "W")["reserved"] == 7

    def test_reserve_over_available_raises(self):
        store = [_make_item("W", 5.0, 10)]
        reserve(store, "W", 6)
        try:
            reserve(store, "W", 5)
            assert False, "should have raised"
        except ValueError:
            pass

    def test_reserve_missing_item_raises(self):
        try:
            reserve([], "X", 1)
            assert False, "should have raised"
        except KeyError:
            pass
