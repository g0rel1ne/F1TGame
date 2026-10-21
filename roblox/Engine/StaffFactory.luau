-- Ported 1:1 from src/data/staff.ts
-- Staff construction. RNG consumption order matches the TypeScript exactly.

local Rng = require(script.Parent.Rng)
local Staff = require(script.Parent.Parent.Data.Staff)

local RngClass = Rng.Rng
local clamp = Rng.clamp
local round = Rng.round

local FIRST = Staff.FIRST
local LAST = Staff.LAST
local STAFF_ROLES = Staff.STAFF_ROLES
local CORE_ROLES = Staff.CORE_ROLES

local NATIONS = { "British", "Italian", "German", "French", "Spanish", "Dutch", "Japanese", "American", "Brazilian" }

local StaffFactory = {}

local function roleMeta(role)
	for _, r in ipairs(STAFF_ROLES) do
		if r.role == role then
			return r
		end
	end
	return STAFF_ROLES[1]
end

local function staffName(seed)
	local rng = RngClass.new("staffname:" .. seed)
	return rng:pick(FIRST) .. " " .. rng:pick(LAST)
end

local function makeStaff(role, skill, careerId, seedKey)
	local rng = RngClass.new(seedKey)
	local meta = roleMeta(role)
	local age = rng:int(30, 58)
	local wage = round(meta.salaryBase * (0.35 + (skill / 100) * 0.75) * rng:range(0.9, 1.1))

	return {
		id = "staff-" .. seedKey,
		careerId = careerId,
		teamId = nil,
		name = staffName(seedKey),
		role = role,
		nationality = rng:pick(NATIONS),
		age = age,
		skill = round(clamp(skill + rng:gaussian(0, 3), 35, 99)),
		potential = round(clamp(skill + rng:range(0, 14), 40, 99)),
		wage = wage,
		morale = round(rng:range(60, 85)),
		experience = round(clamp((age - 28) * 4 + rng:gaussian(0, 6), 5, 100)),
	}
end

-- Build a full staff roster for a team at a given quality tier (0..1).
local function buildStaff(careerId, teamId, quality, seedKey)
	local rng = RngClass.new("staffteam:" .. seedKey)
	local out = {}
	for i, role in ipairs(CORE_ROLES) do
		local skill = clamp(55 + quality * 38 + rng:gaussian(0, 6), 35, 99)
		local s = makeStaff(role, skill, careerId, seedKey .. ":" .. role)
		s.teamId = teamId
		out[i] = s
	end
	return out
end

-- Free-agent staff for the market.
local function buildStaffMarket(careerId, count, seed)
	count = count or 24
	seed = seed or "market"
	local rng = RngClass.new("staffmarket:" .. seed)
	local out = {}
	for i = 0, count - 1 do
		local role = rng:pick(CORE_ROLES)
		local skill = clamp(rng:gaussian(72, 12), 40, 97)
		out[#out + 1] = makeStaff(role, skill, careerId, seed .. ":" .. i .. ":" .. role)
	end
	return out
end

StaffFactory.roleMeta = roleMeta
StaffFactory.staffName = staffName
StaffFactory.makeStaff = makeStaff
StaffFactory.buildStaff = buildStaff
StaffFactory.buildStaffMarket = buildStaffMarket

return StaffFactory
