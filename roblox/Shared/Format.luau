-- Ported from src/lib/format.ts

local Format = {}

local function groupThousands(n)
	local neg = n < 0
	local s = string.format("%d", math.floor(math.abs(n) + 0.5))
	local out = s
	while true do
		local replaced, count = string.gsub(out, "^(%d+)(%d%d%d)", "%1,%2")
		out = replaced
		if count == 0 then
			break
		end
	end
	return (neg and "-" or "") .. out
end

function Format.money(n, opts)
	if type(opts) == "boolean" then
		opts = { compact = opts }
	end
	opts = opts or {}
	local abs = math.abs(n)
	local sign = n < 0 and "-" or ""
	if opts.compact then
		if abs >= 1e9 then
			return sign .. "$" .. string.format("%.1f", abs / 1e9) .. "B"
		elseif abs >= 1e6 then
			return sign .. "$" .. string.format("%.1f", abs / 1e6) .. "M"
		elseif abs >= 1e3 then
			return sign .. "$" .. string.format("%.0f", abs / 1e3) .. "K"
		end
	end
	return sign .. "$" .. groupThousands(abs)
end

function Format.lapTime(seconds)
	if seconds == nil or seconds ~= seconds or seconds == math.huge or seconds == -math.huge then
		return "—"
	end
	local m = math.floor(seconds / 60)
	local s = seconds - m * 60
	if m > 0 then
		local ss = string.format("%.3f", s)
		while #ss < 6 do
			ss = "0" .. ss
		end
		return string.format("%d:%s", m, ss)
	end
	return string.format("%.3f", s)
end

function Format.gap(seconds)
	if seconds == nil or seconds ~= seconds or seconds == math.huge or seconds == -math.huge then
		return "—"
	end
	if seconds <= 0 then
		return "LEADER"
	end
	return string.format("+%.3f", seconds)
end

function Format.ordinal(n)
	local v = n % 100
	local suffix
	if v >= 11 and v <= 13 then
		suffix = "th"
	else
		local d = v % 10
		if d == 1 then
			suffix = "st"
		elseif d == 2 then
			suffix = "nd"
		elseif d == 3 then
			suffix = "rd"
		else
			suffix = "th"
		end
	end
	return tostring(n) .. suffix
end

function Format.initials(name)
	local out = {}
	for part in string.gmatch(name or "", "%S+") do
		out[#out + 1] = part:sub(1, 1)
		if #out == 2 then
			break
		end
	end
	return string.upper(table.concat(out))
end

function Format.timeAgo(ts)
	local now = DateTime.now().UnixTimestampMillis
	local diff = math.max(0, now - ts)
	local mins = math.floor(diff / 60000)
	if mins < 1 then
		return "just now"
	elseif mins < 60 then
		return mins .. "m ago"
	end
	local hours = math.floor(mins / 60)
	if hours < 24 then
		return hours .. "h ago"
	end
	return math.floor(hours / 24) .. "d ago"
end

return Format
