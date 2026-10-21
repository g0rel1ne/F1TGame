-- Ported 1:1 from src/engine/liveSession.ts
-- Wire protocol for the online live race: pure helpers shared by host and guests.

local LiveSession = {}

LiveSession.LIVE_SPEEDS = { 1, 2, 4 }

function LiveSession.emptyVotes()
	return { speed = {}, skip = {} }
end

-- A vote needs a strict majority: one voice can never outvote a tied lobby.
function LiveSession.majorityNeed(memberCount)
	return math.max(1, math.floor(memberCount / 2) + 1)
end

-- The agreed speed, or nil while the lobby is split.
function LiveSession.resolveSpeed(votes, memberIds)
	local need = LiveSession.majorityNeed(#memberIds)
	local tally = {}
	local order = {}
	for _, id in ipairs(memberIds) do
		local speed = votes[id]
		if speed then
			if tally[speed] == nil then
				tally[speed] = 0
				order[#order + 1] = speed
			end
			tally[speed] = tally[speed] + 1
		end
	end
	local best = nil
	for _, speed in ipairs(order) do
		local count = tally[speed]
		if count >= need and (best == nil or count > best.count) then
			best = { speed = speed, count = count }
		end
	end
	if best == nil then
		return nil
	end
	return best.speed
end

-- Whether enough members voted to skip the rest of the race.
function LiveSession.resolveSkip(skipVotes, memberIds)
	local need = LiveSession.majorityNeed(#memberIds)
	local count = 0
	for _, id in ipairs(memberIds) do
		for _, s in ipairs(skipVotes) do
			if s == id then
				count += 1
				break
			end
		end
	end
	return count >= need
end

-- How many members voted for each speed (for the UI).
function LiveSession.speedTally(votes, memberIds)
	local out = { [1] = 0, [2] = 0, [4] = 0 }
	for _, id in ipairs(memberIds) do
		local speed = votes[id]
		if speed then
			out[speed] += 1
		end
	end
	return out
end

-- Real-world seconds one simulated lap takes on screen at 1x.
function LiveSession.baseLapSeconds(referenceLapSeconds)
	return math.min(11, math.max(5.5, referenceLapSeconds / 11))
end

-- Real-world milliseconds per lap at a given speed.
function LiveSession.lapMsFor(referenceLapSeconds, speed)
	return (LiveSession.baseLapSeconds(referenceLapSeconds) / speed) * 1000
end

-- True when a Date.now()-style clock is beyond the beat's expected life.
function LiveSession.beatStale(beat, now, graceLaps)
	graceLaps = graceLaps or 6
	local life = math.max(1500, beat.lapMs) * graceLaps
	return now - beat.at > life
end

return LiveSession
