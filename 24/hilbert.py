class Hilbert:
    def __init__(self, n: int = 8, max_coord: int = 1000):
        self.n = n
        self.max_coord = max_coord
        self.grid_size = 1 << n

    def coord_to_grid(self, x: int, y: int) -> tuple:
        gx = int(x * (self.grid_size - 1) / self.max_coord)
        gy = int(y * (self.grid_size - 1) / self.max_coord)
        gx = max(0, min(self.grid_size - 1, gx))
        gy = max(0, min(self.grid_size - 1, gy))
        return gx, gy

    def grid_to_coord(self, gx: int, gy: int) -> tuple:
        x = gx * self.max_coord / (self.grid_size - 1)
        y = gy * self.max_coord / (self.grid_size - 1)
        return round(x, 2), round(y, 2)

    def encode_grid(self, gx: int, gy: int) -> int:
        return self._hilbert_index(gx, gy)

    def encode(self, x: int, y: int) -> int:
        gx, gy = self.coord_to_grid(x, y)
        return self._hilbert_index(gx, gy)

    def decode(self, d: int) -> tuple:
        gx, gy = self._hilbert_point(d)
        return self.grid_to_coord(gx, gy)

    def _hilbert_index(self, x: int, y: int) -> int:
        n = self.n
        rx = ry = t = 0
        s = 1 << (n - 1)
        d = 0
        tx, ty = x, y

        while s > 0:
            rx = 1 if (tx & s) else 0
            ry = 1 if (ty & s) else 0
            d += s * s * ((3 * rx) ^ ry)
            tx, ty = self._rotate(s, tx, ty, rx, ry)
            s >>= 1
        return d

    def _hilbert_point(self, d: int) -> tuple:
        n = self.n
        rx = ry = t = 0
        s = 1
        x = y = 0
        td = d

        while s < (1 << n):
            rx = 1 & (td >> 1)
            ry = 1 & (td ^ rx)
            x, y = self._rotate(s, x, y, rx, ry)
            x += s * rx
            y += s * ry
            td >>= 2
            s <<= 1
        return x, y

    def _rotate(self, n: int, x: int, y: int, rx: int, ry: int) -> tuple:
        if ry == 0:
            if rx == 1:
                x = n - 1 - x
                y = n - 1 - y
            x, y = y, x
        return x, y

    def get_max_index(self) -> int:
        return (1 << (2 * self.n)) - 1
