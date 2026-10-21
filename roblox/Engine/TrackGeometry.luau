-- Ported 1:1 from src/lib/trackGeometry.ts
-- Shared circuit geometry: one conditioned centre-line per track from which the
-- road, kerbs, racing line, speed profile, sector markers and pit lane derive.

local Rng = require(script.Parent.Rng)
local round = Rng.round

local TrackGeometry = {}

local SPACING = 2

-- -- JS math parity -----------------------------------------------------------

local function wrap(t)
	return t % 1
end

local function jsSign(x)
	if x > 0 then
		return 1
	elseif x < 0 then
		return -1
	else
		return x
	end
end

-- V8's Math.hypot scales by the largest magnitude before squaring.
local function hypot(a, b)
	local aa = math.abs(a)
	local bb = math.abs(b)
	local max = aa > bb and aa or bb
	if max == 0 then
		return 0
	end
	local x = a / max
	local y = b / max
	return max * math.sqrt(x * x + y * y)
end

local function f2(v)
	return string.format("%.2f", v)
end

local function minOf(arr)
	local m = arr[1]
	for i = 2, #arr do
		if arr[i] < m then
			m = arr[i]
		end
	end
	return m
end

local function maxOf(arr)
	local m = arr[1]
	for i = 2, #arr do
		if arr[i] > m then
			m = arr[i]
		end
	end
	return m
end

-- Convert a flat {x1,y1,x2,y2,...} outline into {x=,y=} points (no-op if paired).
local function pointsOf(outline)
	if type(outline[1]) == "number" then
		local out = {}
		for i = 1, #outline - 1, 2 do
			out[#out + 1] = { x = outline[i], y = outline[i + 1] }
		end
		return out
	end
	return outline
end

-- -- low level geometry helpers ------------------------------------------------

local function mapOutline(outline, W, H, pad)
	local xs = {}
	local ys = {}
	for i, p in ipairs(outline) do
		xs[i] = p.x
		ys[i] = p.y
	end
	local sumX = 0
	local sumY = 0
	for i = 1, #xs do
		sumX += xs[i]
		sumY += ys[i]
	end
	local cx = sumX / #xs
	local cy = sumY / #ys

	local sxx = 0
	local syy = 0
	local sxy = 0
	for _, p in ipairs(outline) do
		local dx = p.x - cx
		local dy = p.y - cy
		sxx += dx * dx
		syy += dy * dy
		sxy += dx * dy
	end
	local angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
	local function rotate(a)
		local cos = math.cos(a)
		local sin = math.sin(a)
		local out = {}
		for i, p in ipairs(outline) do
			out[i] = { x = (p.x - cx) * cos - (p.y - cy) * sin, y = (p.x - cx) * sin + (p.y - cy) * cos }
		end
		return out
	end
	local function bounds(pts)
		local pxs = {}
		local pys = {}
		for i, p in ipairs(pts) do
			pxs[i] = p.x
			pys[i] = p.y
		end
		return { minX = minOf(pxs), maxX = maxOf(pxs), minY = minOf(pys), maxY = maxOf(pys) }
	end
	local rotated = rotate(-angle)
	local b = bounds(rotated)
	if b.maxY - b.minY > b.maxX - b.minX then
		angle += math.pi / 2
		rotated = rotate(-angle)
		b = bounds(rotated)
	end
	local minX, maxX, minY, maxY = b.minX, b.maxX, b.minY, b.maxY
	local s = math.min((W - pad * 2) / math.max(0.001, maxX - minX), (H - pad * 2) / math.max(0.001, maxY - minY))
	local offsetX = (W - (maxX - minX) * s) / 2
	local offsetY = (H - (maxY - minY) * s) / 2
	local out = {}
	for i, p in ipairs(rotated) do
		out[i] = { x = offsetX + (p.x - minX) * s, y = offsetY + (p.y - minY) * s }
	end
	return out
end

local function resample(pts, spacing)
	local n = #pts
	if n < 2 then
		local out = {}
		for i = 1, n do
			out[i] = pts[i]
		end
		return out
	end
	local segs = {}
	local total = 0
	for i = 1, n do
		local p = pts[i]
		local q = pts[(i % n) + 1]
		local len = hypot(q.x - p.x, q.y - p.y)
		segs[i] = { a = p, b = q, len = len }
		total += len
	end
	local count = math.max(48, round(total / spacing))
	local step = total / count
	local out = {}
	local si = 1
	local acc = 0
	for k = 0, count - 1 do
		local target = k * step
		while si < #segs and acc + segs[si].len < target do
			acc += segs[si].len
			si += 1
		end
		local seg = segs[si]
		local f = seg.len > 1e-9 and (target - acc) / seg.len or 0
		out[#out + 1] = { x = seg.a.x + (seg.b.x - seg.a.x) * f, y = seg.a.y + (seg.b.y - seg.a.y) * f }
	end
	return out
end

local function chaikin(pts, iters)
	local cur = pts
	for _ = 1, iters do
		local out = {}
		local n = #cur
		for i = 1, n do
			local a = cur[i]
			local b = cur[(i % n) + 1]
			out[#out + 1] = { x = a.x * 0.75 + b.x * 0.25, y = a.y * 0.75 + b.y * 0.25 }
			out[#out + 1] = { x = a.x * 0.25 + b.x * 0.75, y = a.y * 0.25 + b.y * 0.75 }
		end
		cur = out
	end
	return cur
end

local function laplace(pts, lambda, iters)
	local cur = pts
	for _ = 1, iters do
		local next_ = {}
		local n = #cur
		for i = 1, n do
			local p = cur[i]
			local a = cur[((i - 2) % n) + 1]
			local b = cur[(i % n) + 1]
			next_[i] = { x = p.x + lambda * ((a.x + b.x) / 2 - p.x), y = p.y + lambda * ((a.y + b.y) / 2 - p.y) }
		end
		cur = next_
	end
	return cur
end

local function refit(pts, pad, W, H)
	local xs = {}
	local ys = {}
	for i, p in ipairs(pts) do
		xs[i] = p.x
		ys[i] = p.y
	end
	local minX = minOf(xs)
	local maxX = maxOf(xs)
	local minY = minOf(ys)
	local maxY = maxOf(ys)
	local s = math.min((W - pad * 2) / math.max(0.001, maxX - minX), (H - pad * 2) / math.max(0.001, maxY - minY))
	local ox = (W - (maxX - minX) * s) / 2
	local oy = (H - (maxY - minY) * s) / 2
	local function apply(p)
		return { x = ox + (p.x - minX) * s, y = oy + (p.y - minY) * s }
	end
	local out = {}
	for i, p in ipairs(pts) do
		out[i] = apply(p)
	end
	return { pts = out, apply = apply }
end

local function curvatureAt(pts)
	local n = #pts
	local out = {}
	for i = 1, n do
		local a = pts[((i - 2) % n) + 1]
		local b = pts[i]
		local c = pts[(i % n) + 1]
		local abx = b.x - a.x
		local aby = b.y - a.y
		local bcx = c.x - b.x
		local bcy = c.y - b.y
		local cross = abx * bcy - aby * bcx
		local l1 = hypot(abx, aby)
		if l1 == 0 then l1 = 1 end
		local l2 = hypot(bcx, bcy)
		if l2 == 0 then l2 = 1 end
		local l3 = hypot(c.x - a.x, c.y - a.y)
		if l3 == 0 then l3 = 1 end
		out[i] = (2 * cross) / (l1 * l2 * l3)
	end
	return out
end

local function smoothSeries(values, win)
	local n = #values
	local out = {}
	for i = 1, n do
		local sum = 0
		local w = 0
		for j = -win, win do
			local wt = 1 - math.abs(j) / (win + 1)
			sum += values[((i + j - 1) % n) + 1] * wt
			w += wt
		end
		out[i] = sum / w
	end
	return out
end

local function segIntersect(a, b, c, d)
	local function o(p, q, r)
		return jsSign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
	end
	return o(a, b, c) ~= o(a, b, d) and o(c, d, a) ~= o(c, d, b)
end

local function relax(pts, required, iters)
	local cur = pts
	local n = #cur
	local sigma = 6
	local kernel = {}
	for k = -sigma * 2, sigma * 2 do
		kernel[#kernel + 1] = math.exp((-k * k) / (2 * sigma * sigma))
	end

	for _ = 1, iters do
		local disp = {}
		for i = 1, n do
			disp[i] = { x = 0, y = 0 }
		end
		local cell = required
		local grid = {}
		for i = 1, n do
			local key = math.floor(cur[i].x / cell) .. "," .. math.floor(cur[i].y / cell)
			local arr = grid[key]
			if arr then
				arr[#arr + 1] = i
			else
				grid[key] = { i }
			end
		end
		local moved = 0
		for i = 1, n do
			local gx = math.floor(cur[i].x / cell)
			local gy = math.floor(cur[i].y / cell)
			for dx = -1, 1 do
				for dy = -1, 1 do
					local arr = grid[(gx + dx) .. "," .. (gy + dy)]
					if arr then
						for _, j in ipairs(arr) do
							if j > i + 8 then
								local arc = math.min(j - i, n - (j - i))
								if arc >= 30 then
									local ddx = cur[j].x - cur[i].x
									local ddy = cur[j].y - cur[i].y
									local dist = hypot(ddx, ddy)
									if dist < required and dist >= 1e-6 then
										if not segIntersect(cur[i], cur[(i % n) + 1], cur[j], cur[(j % n) + 1]) then
											local push = (required - dist) * 0.35
											local ux = ddx / dist
											local uy = ddy / dist
											for k = -sigma * 2, sigma * 2 do
												local w = kernel[k + sigma * 2 + 1]
												local a = ((i + k - 1) % n) + 1
												local b = ((j + k - 1) % n) + 1
												disp[a].x -= ux * push * w * 0.5
												disp[a].y -= uy * push * w * 0.5
												disp[b].x += ux * push * w * 0.5
												disp[b].y += uy * push * w * 0.5
											end
											moved += 1
										end
									end
								end
							end
						end
					end
				end
			end
		end
		if moved == 0 then
			break
		end
		for i = 1, n do
			local d = disp[i]
			local len = hypot(d.x, d.y)
			if len > 0.8 then
				d.x = (d.x / len) * 0.8
				d.y = (d.y / len) * 0.8
			end
			cur[i] = { x = cur[i].x + d.x, y = cur[i].y + d.y }
		end
	end
	return cur
end

local function enforceMinRadius(pts, minRadius, iters)
	local cur = pts
	local limit = 1 / minRadius
	for _ = 1, iters do
		local n = #cur
		local k = smoothSeries(curvatureAt(cur), 3)
		local mask = {}
		local any = false
		for i = 1, n do
			mask[i] = math.abs(k[i]) > limit
			if mask[i] then
				any = true
			end
		end
		if not any then
			break
		end
		local next_ = {}
		for i = 1, n do
			local near = false
			for j = -6, 6 do
				if mask[((i + j - 1) % n) + 1] then
					near = true
					break
				end
			end
			if not near then
				next_[i] = cur[i]
			else
				local p = cur[i]
				local a = cur[((i - 3) % n) + 1]
				local b = cur[((i + 1) % n) + 1]
				next_[i] = { x = p.x + 0.5 * ((a.x + b.x) / 2 - p.x), y = p.y + 0.5 * ((a.y + b.y) / 2 - p.y) }
			end
		end
		cur = next_
	end
	return cur
end

local function countCrossings(pts)
	local n = #pts
	local count = 0
	for i = 1, n - 1 do
		for j = i + 2, n - 1 do
			if not (i == 1 and j == n - 1) then
				if segIntersect(pts[i], pts[(i % n) + 1], pts[j], pts[(j % n) + 1]) then
					count += 1
					if count > 8 then
						return count
					end
				end
			end
		end
	end
	return count
end

local function findCorners(k, cum, threshold, minArc)
	local n = #k
	local runs = {}
	local inside = {}
	for i = 1, n do
		inside[i] = math.abs(k[i]) > threshold
	end
	local i = 1
	while i <= n do
		if not inside[i] then
			i += 1
		else
			local start = i
			while i <= n and inside[i] do
				i += 1
			end
			local end_ = i - 1
			if end_ > start then
				local sum = 0
				local peak = start
				local peakK = 0
				for j = start, end_ do
					sum += k[j]
					if math.abs(k[j]) > math.abs(peakK) then
						peakK = k[j]
						peak = j
					end
				end
				local arc = cum[end_] - cum[start]
				if arc >= minArc then
					local sg = jsSign(sum)
					if sg == 0 then sg = 1 end
					runs[#runs + 1] = { startArc = cum[start], apexArc = cum[peak], endArc = cum[end_], sign = sg, strength = math.abs(peakK) }
				end
			end
		end
	end
	return runs
end

local function makeArcIndexer(cum, totalLength)
	local n = #cum
	return function(arc)
		local a = wrap(arc / totalLength) * totalLength
		local lo = 0
		local hi = n - 1
		while lo < hi - 1 do
			local mid = math.floor((lo + hi) / 2)
			if cum[mid + 1] <= a then
				lo = mid
			else
				hi = mid
			end
		end
		return lo
	end
end

local function buildRacingOffsets(dense, k, cum, totalLength, roadWidth)
	local n = #dense
	local halfW = roadWidth / 2
	local maxOffset = math.max(0.8, halfW - math.max(1.9, roadWidth * 0.19))
	local target = {}
	for i = 1, n do
		target[i] = 0
	end

	local corners = findCorners(k, cum, 0.010, 16)
	for _, c in ipairs(corners) do
		local dir = c.sign
		local inside = -dir
		local lenBefore = math.max(2, (c.apexArc - c.startArc + totalLength) % totalLength)
		local lenAfter = math.max(2, (c.endArc - c.apexArc + totalLength) % totalLength)
		local ramp = math.min(30, math.max(10, (lenBefore + lenAfter) * 0.45))
		local entry = lenBefore + ramp
		local exit = lenAfter + ramp
		local insideVal = inside * maxOffset * 0.98
		local outsideEntry = inside * -1 * maxOffset * 0.9
		local outsideExit = inside * -1 * maxOffset * 0.68
		for i = 1, n do
			local arc = cum[i]
			local delta = (arc - c.apexArc) % totalLength
			local d = delta > totalLength / 2 and delta - totalLength or delta
			if d > -entry and d <= 0 then
				local t = (d + entry) / entry
				local s = t * t * (3 - 2 * t)
				target[i] += outsideEntry + (insideVal - outsideEntry) * s
			elseif d > 0 and d < exit then
				local t = d / exit
				local s = t * t * (3 - 2 * t)
				target[i] += insideVal + (outsideExit - insideVal) * s
			end
		end
	end

	local offset = smoothSeries(target, 3)

	local maxSlope = 0.3 * SPACING
	local function limit(arr)
		local out = {}
		for i = 1, n do
			out[i] = arr[i]
		end
		for _ = 1, 3 do
			for i = 2, n do
				out[i] = math.max(out[i - 1] - maxSlope, math.min(out[i - 1] + maxSlope, out[i]))
			end
			out[1] = math.max(out[n] - maxSlope, math.min(out[n] + maxSlope, out[1]))
		end
		return out
	end
	offset = limit(offset)

	for i = 1, n do
		local ki = k[i]
		local cap = maxOffset
		if math.abs(ki) > 1e-4 then
			cap = math.min(cap, 0.85 / math.abs(ki))
		end
		offset[i] = math.max(-cap, math.min(cap, offset[i]))
	end

	offset = smoothSeries(offset, 2)
	for i = 1, n do
		offset[i] = math.max(-maxOffset, math.min(maxOffset, offset[i]))
	end
	return offset
end

local function buildSpeedProfile(racing, cum)
	local n = #racing
	local k = smoothSeries(curvatureAt(racing), 4)
	local ds = {}
	for i = 1, n do
		ds[i] = SPACING
	end
	for i = 2, n do
		ds[i] = math.max(0.5, cum[i] - cum[i - 1])
	end
	local vMax = 1
	local K0 = 0.05
	local v = {}
	for i = 1, n do
		local kk = k[i]
		v[i] = math.max(0.32, vMax / math.sqrt(1 + (math.abs(kk) / K0) ^ 2))
	end
	local aBrake = 0.02
	local aAccel = 0.014
	for _ = 1, 2 do
		for i = n, 1, -1 do
			local next_ = v[(i % n) + 1]
			local d = i == n and cum[1] + SPACING or ds[i + 1]
			v[i] = math.min(v[i], math.sqrt(next_ * next_ + 2 * aBrake * math.max(0.5, d)))
		end
	end
	for _ = 1, 2 do
		for i = 2, n do
			v[i] = math.min(v[i], math.sqrt(v[i - 1] * v[i - 1] + 2 * aAccel * ds[i]))
		end
		v[1] = math.min(v[1], math.sqrt(v[n] * v[n] + 2 * aAccel * ds[1]))
	end
	local times = {}
	for i = 1, n do
		times[i] = 0
	end
	for i = 2, n do
		times[i] = times[i - 1] + ds[i] / v[i]
	end
	local total = times[n] + (cum[1] + SPACING) / v[1]
	return { speed = v, times = times, total = total }
end

local function lineIntersection(a, b, c, d)
	local r = { x = b.x - a.x, y = b.y - a.y }
	local s = { x = d.x - c.x, y = d.y - c.y }
	local denom = r.x * s.y - r.y * s.x
	if math.abs(denom) < 1e-9 then
		return nil
	end
	local t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom
	return { x = a.x + r.x * t, y = a.y + r.y * t }
end

local function buildBridges(dense)
	local n = #dense
	local bridges = {}
	local seen = {}
	for i = 1, n - 1 do
		for j = i + 2, n - 1 do
			if not (i == 1 and j == n - 1) then
				if segIntersect(dense[i], dense[(i % n) + 1], dense[j], dense[(j % n) + 1]) then
					local p = lineIntersection(dense[i], dense[(i % n) + 1], dense[j], dense[(j % n) + 1])
					if p then
						local dupe = false
						for _, s in ipairs(seen) do
							if hypot(s.x - p.x, s.y - p.y) < 6 then
								dupe = true
								break
							end
						end
						if not dupe then
							seen[#seen + 1] = p
							local half = 9
							local pts = {}
							for kk = -half, half do
								local idx = ((j - 1 + kk) % n) + 1
								pts[#pts + 1] = (kk == -half and "M" or "L") .. " " .. f2(dense[idx].x) .. " " .. f2(dense[idx].y)
							end
							local a = dense[(((j - 1) - 1) % n) + 1]
							local b = dense[((j + 1 - 1) % n) + 1]
							bridges[#bridges + 1] = { d = table.concat(pts, " "), x = p.x, y = p.y, angle = (math.atan2(b.y - a.y, b.x - a.x) * 180) / math.pi }
						end
					end
				end
			end
		end
	end
	return bridges
end

local function polylinePath(pts)
	if #pts == 0 then
		return ""
	end
	local d = "M " .. f2(pts[1].x) .. " " .. f2(pts[1].y)
	for i = 2, #pts do
		d = d .. " L " .. f2(pts[i].x) .. " " .. f2(pts[i].y)
	end
	return d .. " Z"
end

-- -- main entry point ----------------------------------------------------------

function TrackGeometry.buildTrack(circuit, W, H, pad, roadWidth)
	W = W or 400
	H = H or 240
	pad = pad or 18
	roadWidth = roadWidth or 10

	local mapped = mapOutline(pointsOf(circuit.outline), W, H, pad)
	local anchor0 = mapped[1] or { x = W / 2, y = H / 2 }

	local anchor = anchor0
	local poly = resample(chaikin(mapped, 3), SPACING)
	poly = laplace(poly, 0.6, 120)
	do
		local first = refit(poly, 16, W, H)
		poly = resample(first.pts, SPACING)
		anchor = first.apply(anchor)
	end

	if countCrossings(poly) == 0 then
		poly = relax(poly, roadWidth + 3, 60)
	end
	poly = enforceMinRadius(poly, 6, 120)
	poly = laplace(poly, 0.35, 3)
	do
		local final = refit(resample(poly, SPACING), 16, W, H)
		poly = final.pts
		anchor = final.apply(anchor)
	end

	-- Roll the loop so index 0 sits on the real start/finish line.
	local best = 1
	local bestDist = math.huge
	for i = 1, #poly do
		local d = hypot(poly[i].x - anchor.x, poly[i].y - anchor.y)
		if d < bestDist then
			bestDist = d
			best = i
		end
	end
	local dense = {}
	for i = best, #poly do
		dense[#dense + 1] = poly[i]
	end
	for i = 1, best - 1 do
		dense[#dense + 1] = poly[i]
	end

	local n = #dense
	local cum = {}
	for i = 1, n do
		cum[i] = 0
	end
	for i = 2, n do
		cum[i] = cum[i - 1] + hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y)
	end
	local totalLength = cum[n] ~= 0 and cum[n] or 1

	local normals = {}
	for i = 1, n do
		local a = dense[((i - 2) % n) + 1]
		local b = dense[(i % n) + 1]
		local dx = b.x - a.x
		local dy = b.y - a.y
		local len = hypot(dx, dy)
		if len == 0 then len = 1 end
		normals[i] = { x = -dy / len, y = dx / len }
	end

	local rawK = curvatureAt(dense)
	local smoothK = smoothSeries(rawK, 4)

	local function indexAt(t)
		local tgt = wrap(t) * totalLength
		local lo = 0
		local hi = n - 1
		while lo < hi - 1 do
			local mid = math.floor((lo + hi) / 2)
			if cum[mid + 1] <= tgt then
				lo = mid
			else
				hi = mid
			end
		end
		local span = cum[lo + 2] - cum[lo + 1]
		if span == 0 then span = 1 end
		return lo, (tgt - cum[lo + 1]) / span
	end

	local function pointAt(t)
		local i, frac = indexAt(t)
		local a = dense[i + 1]
		local b = dense[i + 2] or dense[1]
		return { x = a.x + (b.x - a.x) * frac, y = a.y + (b.y - a.y) * frac }
	end

	local function normalAt(t)
		local i, frac = indexAt(t)
		local a = normals[i + 1]
		local b = normals[i + 2] or normals[1]
		local x = a.x + (b.x - a.x) * frac
		local y = a.y + (b.y - a.y) * frac
		local len = hypot(x, y)
		if len == 0 then len = 1 end
		return { x = x / len, y = y / len }
	end

	local function angleAt(t)
		local p = pointAt(t)
		local q = pointAt(t + 0.004)
		return math.atan2(q.y - p.y, q.x - p.x)
	end

	local function offsetAt(t, lateral)
		local p = pointAt(t)
		local nrm = normalAt(t)
		return { x = p.x + nrm.x * lateral, y = p.y + nrm.y * lateral }
	end

	local function offsetPath(fromT, toT, lateral, slices)
		slices = slices or 64
		local span = wrap(toT - fromT)
		if span == 0 then span = 1 end
		local pts = {}
		for i = 0, slices do
			local t = fromT + span * (i / slices)
			local p = offsetAt(t, lateral)
			pts[#pts + 1] = (i == 0 and "M" or "L") .. " " .. f2(p.x) .. " " .. f2(p.y)
		end
		return table.concat(pts, " ")
	end

	local racingOffset = buildRacingOffsets(dense, smoothK, cum, totalLength, roadWidth)
	local racing = {}
	for i, p in ipairs(dense) do
		racing[i] = { x = p.x + normals[i].x * racingOffset[i], y = p.y + normals[i].y * racingOffset[i] }
	end

	local profile = buildSpeedProfile(racing, cum)
	local speedFactor = profile.speed

	local function progressAtTime(u)
		local tgt = wrap(u) * profile.total
		local lo = 0
		local hi = n - 1
		while lo < hi - 1 do
			local mid = math.floor((lo + hi) / 2)
			if profile.times[mid + 1] <= tgt then
				lo = mid
			else
				hi = mid
			end
		end
		local span = profile.times[lo + 2] - profile.times[lo + 1]
		if span == 0 then span = 1 end
		local frac = (tgt - profile.times[lo + 1]) / span
		local arc = cum[lo + 1] + (cum[lo + 2] - cum[lo + 1]) * frac
		return wrap(arc / totalLength)
	end

	local function racingOffsetAt(t)
		local i, frac = indexAt(t)
		local a = racingOffset[i + 1]
		local b = racingOffset[i + 2] or racingOffset[1]
		return a + (b - a) * frac
	end

	local function racingPointAt(t)
		local p = pointAt(t)
		local nrm = normalAt(t)
		local off = racingOffsetAt(t)
		return { x = p.x + nrm.x * off, y = p.y + nrm.y * off }
	end

	local function speedFactorAt(t)
		local i, frac = indexAt(t)
		local a = speedFactor[i + 1]
		local b = speedFactor[i + 2] or speedFactor[1]
		return a + (b - a) * frac
	end

	local kerbRuns = TrackGeometry.buildKerbs(dense, normals, smoothK, cum, totalLength, roadWidth)
	local bridges = buildBridges(dense)

	return {
		W = W,
		H = H,
		path = polylinePath(dense),
		dense = dense,
		normals = normals,
		cum = cum,
		totalLength = totalLength,
		roadWidth = roadWidth,
		start = dense[1],
		startAngle = angleAt(0),
		kerbRuns = kerbRuns,
		bridges = bridges,
		racingOffset = racingOffset,
		racing = racing,
		speedFactor = speedFactor,
		pointAt = pointAt,
		normalAt = normalAt,
		angleAt = angleAt,
		offsetAt = offsetAt,
		curvatureAt = function(i)
			return rawK[(((i % n) + n) % n) + 1]
		end,
		offsetPath = offsetPath,
		racingOffsetAt = racingOffsetAt,
		racingPointAt = racingPointAt,
		speedFactorAt = speedFactorAt,
		progressAtTime = progressAtTime,
	}
end

function TrackGeometry.buildKerbs(dense, normals, k, cum, totalLength, roadWidth)
	local n = #dense
	local halfW = roadWidth / 2
	local kerbW = math.max(1.8, roadWidth * 0.2)
	local baseLateral = halfW - kerbW / 2
	local corners = findCorners(k, cum, 0.012, 18)
	local runs = {}
	local arcToIndex = makeArcIndexer(cum, totalLength)

	local function inPitWindow(t)
		return t > 0.88 or t < 0.075
	end
	local function nearStart(t)
		return t > 0.95 or t < 0.045
	end

	for _, c in ipairs(corners) do
		local insideSide = jsSign(c.sign)
		local specs = { { side = -insideSide, inside = false } }
		if c.strength > 0.05 then
			specs[#specs + 1] = { side = insideSide, inside = true }
		end

		for _, spec in ipairs(specs) do
			local i0 = arcToIndex(c.startArc - 3 * SPACING)
			local i1 = arcToIndex(c.endArc + 3 * SPACING)
			local span = ((i1 - i0) % n + n) % n
			if span >= 5 then
				local pts = {}
				for s = 0, span do
					local idx = (i0 + s) % n
					local t = cum[idx + 1] / totalLength
					local skip = nearStart(t) or (spec.side == -1 and inPitWindow(t))
					if not skip then
						local lateral = baseLateral
						if spec.inside and math.abs(k[idx + 1]) > 1e-4 then
							lateral = math.min(lateral, 0.8 / math.abs(k[idx + 1]))
						end
						if lateral >= 0.6 then
							local p = dense[idx + 1]
							local nrm = normals[idx + 1]
							pts[#pts + 1] = (#pts == 0 and "M" or "L") .. " " .. f2(p.x + nrm.x * lateral * spec.side) .. " " .. f2(p.y + nrm.y * lateral * spec.side)
						end
					end
				end
				if #pts >= 6 then
					runs[#runs + 1] = { d = table.concat(pts, " "), side = spec.side, inside = spec.inside }
				end
			end
		end
	end
	return runs
end

-- -- cached accessor -----------------------------------------------------------

local cache = {}

function TrackGeometry.getTrack(circuit, W, H, pad, roadWidth)
	W = W or 400
	H = H or 240
	pad = pad or 16
	roadWidth = roadWidth or 10
	local key = circuit.id .. ":" .. W .. "x" .. H .. ":" .. pad .. ":" .. roadWidth
	if cache[key] then
		return cache[key]
	end
	local geo = TrackGeometry.buildTrack(circuit, W, H, pad, roadWidth)
	cache[key] = geo
	return geo
end

return TrackGeometry
