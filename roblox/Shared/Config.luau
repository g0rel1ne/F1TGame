-- Ported from src/backend/types.ts (defaults + theme)
-- Shared configuration: theme palette and career/lobby defaults.

local Config = {}

Config.Colors = {
	carbon950 = Color3.fromHex("08090c"),
	carbon900 = Color3.fromHex("0d0f14"),
	carbon850 = Color3.fromHex("12151c"),
	carbon800 = Color3.fromHex("171b24"),
	carbon700 = Color3.fromHex("1f2530"),
	carbon600 = Color3.fromHex("2b323f"),
	carbon500 = Color3.fromHex("3a4353"),
	raceRed = Color3.fromHex("e10600"),
	raceTeal = Color3.fromHex("00d2be"),
	raceAmber = Color3.fromHex("ffb400"),
	raceGreen = Color3.fromHex("10b981"),
	raceBlue = Color3.fromHex("3b82f6"),
	white = Color3.fromHex("ffffff"),
	gray300 = Color3.fromHex("d1d5db"),
	gray400 = Color3.fromHex("9ca3af"),
	gray500 = Color3.fromHex("6b7280"),
	gray600 = Color3.fromHex("4b5563"),
}

Config.DEFAULT_LOBBY_SETTINGS = {
	maxPlayers = 6,
	isPublic = false,
	aiDifficulty = "normal",
	simSpeed = 5,
	seasonLength = 12,
	qualifyFormat = "q1-q2-q3",
	raceDistancePct = 50,
	startingBudget = 100000000,
	startingSeason = 2026,
	allowMidSeasonJoin = true,
	requireApproval = false,
	incidentSeverity = "realistic",
	driverAvailability = false,
	maxIncidentSeverity = 4,
}

Config.DEFAULT_CAREER_SETTINGS = {
	aiDifficulty = "normal",
	raceDistancePct = 50,
	simSpeed = 5,
	startingSeason = 2026,
	incidentSeverity = "realistic",
	driverAvailability = false,
	seasonLength = 12,
	startBudget = 100000000,
}

function Config.mergeLobbySettings(partial)
	local out = {}
	for k, v in pairs(Config.DEFAULT_LOBBY_SETTINGS) do
		out[k] = v
	end
	if partial then
		for k, v in pairs(partial) do
			if v ~= nil then
				out[k] = v
			end
		end
	end
	return out
end

function Config.settingsFromLobby(settings)
	return {
		aiDifficulty = settings.aiDifficulty,
		raceDistancePct = settings.raceDistancePct,
		simSpeed = settings.simSpeed,
		startingSeason = settings.startingSeason,
		incidentSeverity = settings.incidentSeverity,
		driverAvailability = settings.driverAvailability,
		seasonLength = settings.seasonLength,
		startBudget = settings.startingBudget,
	}
end

return Config
