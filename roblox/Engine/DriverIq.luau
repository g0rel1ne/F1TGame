-- Ported 1:1 from src/engine/driverIq.ts
-- Driver IQ: a 0..1 "how well does this driver read a race?" score derived from
-- raw attributes. Used on track for dirty air, overtaking, defending and late
-- braking. Fully deterministic.

local Rng = require(script.Parent.Rng)
local clamp = Rng.clamp

local DriverIq = {}

local function driverIq(driver)
	local a = driver.attributes
	local function n(v)
		return clamp(v / 100, 0, 1)
	end

	local precision = clamp(
		n(a.pace) * 0.34 + n(a.consistency) * 0.3 + n(a.concentration) * 0.22 + n(a.experience) * 0.14,
		0,
		1
	)
	local attack = clamp(
		n(a.racecraft) * 0.36 + n(a.overtaking) * 0.3 + n(a.aggression) * 0.16 + n(a.pace) * 0.18,
		0,
		1
	)
	local defend = clamp(
		n(a.racecraft) * 0.3 + n(a.defending) * 0.36 + n(a.concentration) * 0.18 + n(a.experience) * 0.16,
		0,
		1
	)
	local overall = clamp(precision * 0.4 + attack * 0.3 + defend * 0.3, 0, 1)

	return { overall = overall, attack = attack, defend = defend, precision = precision }
end

-- How much a circuit rewards a clever driver versus raw bravery. Heavy braking
-- zones and low-grip layouts suit high-IQ drivers; power tracks level the field.
local function circuitIqWeight(circuit)
	return clamp(0.35 + circuit.brakingDemand * 0.35 + circuit.tractionDemand * 0.3, 0.3, 1)
end

-- Convenience: everything the on-track model needs, precomputed per driver.
local function racerSkill(driver)
	local iq = driverIq(driver)
	return {
		iq = iq.overall,
		attack = iq.attack,
		defend = iq.defend,
		aggression = clamp(driver.attributes.aggression, 0, 1),
		overtaking = clamp(driver.attributes.overtaking / 100, 0, 1),
		defending = clamp(driver.attributes.defending / 100, 0, 1),
		concentration = clamp(driver.attributes.concentration / 100, 0, 1),
		experience = clamp(driver.attributes.experience / 100, 0, 1),
	}
end

DriverIq.driverIq = driverIq
DriverIq.circuitIqWeight = circuitIqWeight
DriverIq.racerSkill = racerSkill

return DriverIq
