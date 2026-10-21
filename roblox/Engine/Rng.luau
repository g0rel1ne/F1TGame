-- Ported 1:1 from src/engine/rng.ts
-- Deterministic, seedable PRNG. Byte-for-byte identical to the web engine so
-- the same seed reproduces the same race on every machine. Never use math.random.

local bit32 = bit32

local MASK = 0xFFFFFFFF

local function u32(n: number): number
	return bit32.band(n % 4294967296, MASK)
end

-- Math.imul: 32-bit signed multiply, congruent to the unsigned product mod 2^32.
local function imul(a: number, b: number): number
	a = u32(a)
	b = u32(b)
	local aLow = a % 65536
	local aHigh = math.floor(a / 65536)
	local bLow = b % 65536
	local bHigh = math.floor(b / 65536)
	local low = aLow * bLow
	local mid = (aLow * bHigh + aHigh * bLow) % 65536
	return (low + mid * 65536) % 4294967296
end

-- Feed JS-style UTF-16 code units (matching String.charCodeAt) so non-ASCII
-- names hash identically to the TypeScript implementation.
local function forEachCodeUnit(s: string, fn: (number) -> ())
	local i = 1
	local n = #s
	while i <= n do
		local cp = utf8.codepoint(s, i)
		if cp > 0xFFFF then
			local v = cp - 0x10000
			fn(0xD800 + math.floor(v / 1024))
			fn(0xDC00 + (v % 1024))
		else
			fn(cp)
		end
		i = utf8.offset(s, 2, i) or (n + 1)
	end
end

-- Hash an arbitrary string into a 32-bit unsigned integer seed (FNV-1a).
local function hashSeed(input: string): number
	local h = 2166136261
	forEachCodeUnit(input, function(c)
		h = bit32.bxor(h, c)
		h = imul(h, 16777619)
	end)
	return h
end

local Rng = {}
Rng.__index = Rng

function Rng.new(seed)
	local self = setmetatable({}, Rng)
	if type(seed) == "string" then
		self.state = hashSeed(seed)
	else
		self.state = u32(seed or 0)
	end
	if self.state == 0 then
		self.state = 0x9e3779b9
	end
	return self
end

-- Raw float in [0, 1). mulberry32.
function Rng:next(): number
	self.state = u32(self.state + 0x6d2b79f5)
	local t = imul(bit32.bxor(self.state, bit32.rshift(self.state, 15)), bit32.bor(1, self.state))
	t = bit32.bxor(u32(t + imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(61, t))), t)
	return bit32.bxor(t, bit32.rshift(t, 14)) / 4294967296
end

-- Float in [min, max).
function Rng:range(min: number, max: number): number
	return min + self:next() * (max - min)
end

-- Integer in [min, max] inclusive.
function Rng:int(min: number, max: number): number
	return math.floor(self:range(min, max + 1))
end

-- True with probability p.
function Rng:chance(p: number): boolean
	return self:next() < p
end

-- Standard normal via Box-Muller. Mean 0, stddev 1.
function Rng:normal(): number
	local u = 0
	local v = 0
	while u == 0 do
		u = self:next()
	end
	while v == 0 do
		v = self:next()
	end
	return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)
end

-- Normal with mean and standard deviation.
function Rng:gaussian(mean: number, stddev: number): number
	return mean + self:normal() * stddev
end

-- Pick a random element.
function Rng:pick(items)
	return items[self:int(1, #items)]
end

-- Weighted pick. Weights need not be normalised.
function Rng:weighted(items, weights)
	local total = 0
	for i = 1, #weights do
		total += math.max(0, weights[i])
	end
	if total <= 0 then
		return self:pick(items)
	end
	local roll = self:next() * total
	for i = 1, #items do
		roll -= math.max(0, weights[i])
		if roll <= 0 then
			return items[i]
		end
	end
	return items[#items]
end

-- Fisher-Yates shuffle producing a new array.
function Rng:shuffle(items)
	local out = table.clone(items)
	for i = #out, 2, -1 do
		local j = self:int(1, i)
		out[i], out[j] = out[j], out[i]
	end
	return out
end

-- Derive a child RNG, e.g. per-driver or per-lap streams. Keeps determinism.
function Rng:fork(label: string)
	return Rng.new(hashSeed(self.state .. ":" .. label))
end

-- Current internal state, so a simulation can persist/resume mid-race.
function Rng:getState(): number
	return self.state
end

local function clamp(v: number, min: number, max: number): number
	return math.max(min, math.min(max, v))
end

local function lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

-- JS Math.round parity: ties round toward +infinity.
local function round(v: number, dp: number?): number
	local f = 10 ^ (dp or 0)
	return math.floor(v * f + 0.5) / f
end

return {
	Rng = Rng,
	hashSeed = hashSeed,
	clamp = clamp,
	lerp = lerp,
	round = round,
}
