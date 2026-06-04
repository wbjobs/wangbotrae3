package wind

import (
	"math"
)

type PerlinNoise struct {
	permutation [512]int
}

func NewPerlinNoise(seed int64) *PerlinNoise {
	p := &PerlinNoise{}

	for i := 0; i < 256; i++ {
		p.permutation[i] = i
	}

	rng := newXorshift64(seed)
	for i := 255; i > 0; i-- {
		j := int(rng.Uint64() % uint64(i+1))
		p.permutation[i], p.permutation[j] = p.permutation[j], p.permutation[i]
	}

	for i := 0; i < 256; i++ {
		p.permutation[256+i] = p.permutation[i]
	}

	return p
}

type xorshift64 struct {
	state uint64
}

func newXorshift64(seed int64) *xorshift64 {
	return &xorshift64{state: uint64(seed)}
}

func (x *xorshift64) Uint64() uint64 {
	x.state ^= x.state << 13
	x.state ^= x.state >> 7
	x.state ^= x.state << 17
	return x.state
}

func fade(t float64) float64 {
	return t * t * t * (t*(t*6 - 15) + 10)
}

func lerp(a, b, t float64) float64 {
	return a + t*(b-a)
}

func grad(hash int, x, y, z float64) float64 {
	h := hash & 15
	u := float64(0)
	v := float64(0)

	switch h & 8 {
	case 0:
		u = x
	default:
		u = y
	}

	switch h & 4 {
	case 0:
		v = y
	default:
		if h&12 == 12 {
			v = x
		} else {
			v = z
		}
	}

	result := float64(0)
	if h&1 == 0 {
		result = u
	} else {
		result = -u
	}

	if h&2 == 0 {
		result += v
	} else {
		result -= v
	}

	return result
}

func (p *PerlinNoise) Noise3D(x, y, z float64) float64 {
	xi := int(math.Floor(x)) & 255
	yi := int(math.Floor(y)) & 255
	zi := int(math.Floor(z)) & 255

	xf := x - math.Floor(x)
	yf := y - math.Floor(y)
	zf := z - math.Floor(z)

	u := fade(xf)
	v := fade(yf)
	w := fade(zf)

	aaa := p.permutation[p.permutation[p.permutation[xi]+yi]+zi]
	aba := p.permutation[p.permutation[p.permutation[xi]+yi+1]+zi]
	aab := p.permutation[p.permutation[p.permutation[xi]+yi]+zi+1]
	abb := p.permutation[p.permutation[p.permutation[xi]+yi+1]+zi+1]
	baa := p.permutation[p.permutation[p.permutation[xi+1]+yi]+zi]
	bba := p.permutation[p.permutation[p.permutation[xi+1]+yi+1]+zi]
	bab := p.permutation[p.permutation[p.permutation[xi+1]+yi]+zi+1]
	bbb := p.permutation[p.permutation[p.permutation[xi+1]+yi+1]+zi+1]

	x1 := lerp(grad(aaa, xf, yf, zf), grad(baa, xf-1, yf, zf), u)
	x2 := lerp(grad(aba, xf, yf-1, zf), grad(bba, xf-1, yf-1, zf), u)
	y1 := lerp(x1, x2, v)

	x1 = lerp(grad(aab, xf, yf, zf-1), grad(bab, xf-1, yf, zf-1), u)
	x2 = lerp(grad(abb, xf, yf-1, zf-1), grad(bbb, xf-1, yf-1, zf-1), u)
	y2 := lerp(x1, x2, v)

	return lerp(y1, y2, w)
}

func (p *PerlinNoise) FractalNoise3D(x, y, z float64, octaves int, persistence float64) float64 {
	total := 0.0
	frequency := 1.0
	amplitude := 1.0
	maxValue := 0.0

	for i := 0; i < octaves; i++ {
		total += p.Noise3D(x*frequency, y*frequency, z*frequency) * amplitude
		maxValue += amplitude
		amplitude *= persistence
		frequency *= 2
	}

	return total / maxValue
}

func (p *PerlinNoise) Noise2D(x, y float64) float64 {
	return p.Noise3D(x, y, 0)
}

type PerlinWindField struct {
	noiseX *PerlinNoise
	noiseY *PerlinNoise
	noiseZ *PerlinNoise
}

func NewPerlinWindField(seed int64) *PerlinWindField {
	return &PerlinWindField{
		noiseX: NewPerlinNoise(seed),
		noiseY: NewPerlinNoise(seed + 1000),
		noiseZ: NewPerlinNoise(seed + 2000),
	}
}

func (pwf *PerlinWindField) Sample(x, y, z, time, scale, speed float64) (float64, float64, float64) {
	offset := time * speed

	nx := pwf.noiseX.FractalNoise3D(x*scale+offset, y*scale, z*scale, 3, 0.5)
	ny := pwf.noiseY.FractalNoise3D(x*scale, y*scale+offset, z*scale, 3, 0.5)
	nz := pwf.noiseZ.FractalNoise3D(x*scale, y*scale, z*scale+offset, 3, 0.5)

	return nx, ny, nz
}

func (pwf *PerlinWindField) SampleDirection(x, y, z, time, scale, speed float64) (float64, float64, float64) {
	nx, ny, _ := pwf.Sample(x, y, z, time, scale, speed)

	angleX := nx * math.Pi
	angleY := ny * math.Pi * 0.5

	dx := math.Cos(angleX) * math.Cos(angleY)
	dy := math.Sin(angleY)
	dz := math.Sin(angleX) * math.Cos(angleY)

	return dx, dy, dz
}

func (pwf *PerlinWindField) SampleCurl(x, y, z, time, scale, speed, strength float64) (float64, float64, float64) {
	eps := 0.0001

	_, dy1, _ := pwf.Sample(x, y+eps, z, time, scale, speed)
	_, dy2, _ := pwf.Sample(x, y-eps, z, time, scale, speed)
	_, _, dz1 := pwf.Sample(x, y, z+eps, time, scale, speed)
	_, _, dz2 := pwf.Sample(x, y, z-eps, time, scale, speed)

	dx1, _, _ := pwf.Sample(x+eps, y, z, time, scale, speed)
	dx2, _, _ := pwf.Sample(x-eps, y, z, time, scale, speed)

	curlX := (dz1 - dz2) / (2 * eps) - (dy1 - dy2) / (2 * eps)
	curlY := (dx1 - dx2) / (2 * eps) - (dz1 - dz2) / (2 * eps)
	curlZ := (dy1 - dy2) / (2 * eps) - (dx1 - dx2) / (2 * eps)

	mag := math.Sqrt(curlX*curlX + curlY*curlY + curlZ*curlZ)
	if mag > 0 {
		curlX /= mag
		curlY /= mag
		curlZ /= mag
	}

	return curlX * strength, curlY * strength, curlZ * strength
}
