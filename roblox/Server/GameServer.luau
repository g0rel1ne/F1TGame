-- Roblox-native game server (replaces the Supabase backend / localBackend).
-- Authoritative: owns lobbies, careers and chat, applies career actions through
-- the shared CareerOps module, persists to DataStore (with an in-memory fallback
-- so the game still runs in Studio without API access), and broadcasts state.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Shared = ReplicatedStorage.F1Game.Shared
local Config = require(Shared.Config)
local CareerOps = require(Shared.CareerOps)
local Season = require(Shared.Engine.Season)
local LiveRace = require(Shared.Engine.LiveRace)
local LiveSession = require(Shared.Engine.LiveSession)

local GameServer = {}

-- ---- remotes ---------------------------------------------------------------

local folder = ReplicatedStorage.F1Game:FindFirstChild("Net")
if not folder then
	folder = Instance.new("Folder")
	folder.Name = "Net"
	folder.Parent = ReplicatedStorage.F1Game
end

local function ensure(className, name)
	local inst = folder:FindFirstChild(name)
	if not inst then
		inst = Instance.new(className)
		inst.Name = name
		inst.Parent = folder
	end
	return inst
end

local api = ensure("RemoteFunction", "Api")
local lobbyEvent = ensure("RemoteEvent", "LobbyEvent")
local liveEvent = ensure("RemoteEvent", "LiveEvent")

-- ---- persistence -----------------------------------------------------------

local store
do
	local ok, s = pcall(function()
		return DataStoreService:GetDataStore("F1Game_v1")
	end)
	if ok then
		store = s
	end
end

local memory = {}

local function persist(key, value)
	memory[key] = value
	if store then
		pcall(function()
			store:SetAsync(key, value)
		end)
	end
end

local function fetch(key)
	if store then
		local ok, data = pcall(function()
			return store:GetAsync(key)
		end)
		if ok and data ~= nil then
			return data
		end
	end
	return memory[key]
end

-- ---- ids -------------------------------------------------------------------

local function newId(prefix)
	return prefix .. "-" .. HttpService:GenerateGUID(false):gsub("-", ""):sub(1, 12)
end

local function newCode()
	local alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	local s = {}
	for _ = 1, 8 do
		local i = math.random(1, #alphabet)
		s[#s + 1] = alphabet:sub(i, i)
	end
	return table.concat(s)
end

-- ---- state -----------------------------------------------------------------

local lobbies = {} -- id -> { lobby, bundle, chat }
local playerLobby = {} -- userId(string) -> id
local codeIndex = {} -- code -> id

local function nowMs()
	return DateTime.now().UnixTimestampMillis
end

local function isMember(rec, uid)
	for _, m in ipairs(rec.lobby.members) do
		if tostring(m.userId) == tostring(uid) then
			return m
		end
	end
	return nil
end

local function memberTeamId(rec, uid)
	local m = isMember(rec, uid)
	return m and m.teamId or nil
end

local function saveRecord(rec)
	local live = rec.live
	rec.live = nil
	persist("lobby:" .. rec.lobby.id, rec)
	rec.live = live
	persist("code:" .. rec.lobby.inviteCode, rec.lobby.id)
	for _, m in ipairs(rec.lobby.members) do
		persist("user:" .. tostring(m.userId), rec.lobby.id)
	end
end

local function getRecord(id)
	if lobbies[id] then
		return lobbies[id]
	end
	local rec = fetch("lobby:" .. id)
	if rec and rec.lobby then
		lobbies[id] = rec
		codeIndex[rec.lobby.inviteCode] = id
		return rec
	end
	return nil
end

local function getRecordByCode(code)
	code = string.upper(code or "")
	local id = codeIndex[code]
	if not id then
		id = fetch("code:" .. code)
	end
	if not id then
		return nil
	end
	return getRecord(id)
end

local function playerFromUserId(uid)
	return Players:GetPlayerByUserId(tonumber(uid))
end

local function stateForPlayer(player, rec)
	local uid = tostring(player.UserId)
	local m = rec and isMember(rec, uid) or nil
	return {
		user = { id = uid, username = player.Name },
		lobby = rec and rec.lobby or nil,
		bundle = rec and rec.bundle or nil,
		chat = rec and rec.chat or {},
		isHost = rec and rec.lobby.hostUserId == uid or false,
		myTeamId = m and m.teamId or nil,
	}
end

local function broadcast(id)
	local rec = lobbies[id]
	if not rec then
		return
	end
	for _, m in ipairs(rec.lobby.members) do
		local pl = playerFromUserId(m.userId)
		if pl then
			lobbyEvent:FireClient(pl, { kind = "state", state = stateForPlayer(pl, rec) })
		end
	end
end

-- ---- live race -------------------------------------------------------------
-- The server owns the LiveRace engine and advances one lap per beat, so every
-- principal sees exactly the same race and radio commands are authoritative.

local function liveMessage(rec, t)
	local live = rec.live
	if not live then
		return { kind = "live", t = t or "idle" }
	end
	return {
		kind = "live",
		t = t or "beat",
		snapshot = live.engine:snapshot(),
		events = live.engine.events,
		speed = live.speed,
		paused = live.paused,
		seq = live.seq,
	}
end

local function sendLive(rec, msg)
	for _, m in ipairs(rec.lobby.members) do
		local pl = playerFromUserId(m.userId)
		if pl then
			liveEvent:FireClient(pl, msg)
		end
	end
end

local function broadcastLive(rec, t)
	sendLive(rec, liveMessage(rec, t))
end

local function finishLive(rec)
	local live = rec.live
	if not live then
		return nil
	end
	rec.live = nil
	local out = live.engine:finalize()
	local result = out.result
	result.careerId = rec.bundle.career.id
	result.season = rec.bundle.season.number
	result.raceIndex = rec.bundle.weekend.raceIndex
	result.processed = false
	result.createdAt = nowMs()
	local ok, res = pcall(Season.commitRaceResult, rec.bundle, result)
	if ok then
		rec.bundle = res.bundle
	end
	saveRecord(rec)
	broadcast(rec.lobby.id)
	sendLive(rec, { kind = "live", t = "end", resultId = ok and res.result.id or nil })
	return ok and res.result or nil
end

local function liveLoop(rec)
	local live = rec.live
	if not live then
		return
	end
	local ref = live.engine.circuit.referenceLapSeconds
	while rec.live == live and not live.engine.finished do
		if not live.paused then
			live.engine:step()
			live.seq += 1
			broadcastLive(rec, "beat")
		end
		task.wait(math.max(0.05, LiveSession.lapMsFor(ref, live.speed) / 1000))
	end
	if rec.live == live then
		finishLive(rec)
	end
end

-- ---- lobby helpers ---------------------------------------------------------

local function makeLobby(player, name, settings)
	local uid = tostring(player.UserId)
	local id = newId("lobby")
	local careerId = newId("career")
	local merged = Config.mergeLobbySettings(settings)
	local member = {
		userId = uid,
		username = player.Name,
		teamId = nil,
		isHost = true,
		joinedAt = nowMs(),
		lastSeen = nowMs(),
		online = true,
	}
	local lobby = {
		id = id,
		name = name,
		inviteCode = newCode(),
		hostUserId = uid,
		settings = merged,
		members = { member },
		careerId = careerId,
		createdAt = nowMs(),
		paused = false,
	}
	local bundle = Season.createCareerBundle({
		careerId = careerId,
		lobbyId = id,
		name = name,
		settings = Config.settingsFromLobby(merged),
	})
	local rec = { lobby = lobby, bundle = bundle, chat = {} }
	lobbies[id] = rec
	codeIndex[lobby.inviteCode] = id
	playerLobby[uid] = id
	saveRecord(rec)
	return rec
end

local function handle(player, uid, op, payload)
	if op == "state" then
		local id = playerLobby[uid]
		local rec = id and getRecord(id) or nil
		return { kind = "state", state = stateForPlayer(player, rec) }
	elseif op == "createLobby" then
		local rec = makeLobby(player, payload.name or (player.Name .. "'s Career"), payload.settings)
		broadcast(rec.lobby.id)
		return { kind = "state", state = stateForPlayer(player, rec) }
	elseif op == "joinLobby" then
		local rec = getRecordByCode(payload.code)
		if not rec then
			error("No lobby found with that invitation code.")
		end
		if not isMember(rec, uid) then
			if #rec.lobby.members >= rec.lobby.settings.maxPlayers then
				error("This lobby is full.")
			end
			if rec.lobby.settings.requireApproval and rec.lobby.hostUserId ~= uid then
				error("This lobby requires host approval to join.")
			end
			rec.lobby.members[#rec.lobby.members + 1] = {
				userId = uid,
				username = player.Name,
				teamId = nil,
				isHost = false,
				joinedAt = nowMs(),
				lastSeen = nowMs(),
				online = true,
			}
		end
		playerLobby[uid] = rec.lobby.id
		saveRecord(rec)
		broadcast(rec.lobby.id)
		return { kind = "state", state = stateForPlayer(player, rec) }
	elseif op == "openLobby" then
		local rec = getRecord(payload.lobbyId)
		if not rec then
			error("Lobby not found.")
		end
		if not isMember(rec, uid) then
			error("You are not a member of this lobby.")
		end
		playerLobby[uid] = rec.lobby.id
		return { kind = "state", state = stateForPlayer(player, rec) }
	elseif op == "leaveLobby" then
		local rec = getRecord(payload.lobbyId or playerLobby[uid])
		if rec then
			rec.lobby.members = (function()
				local o = {}
				for _, m in ipairs(rec.lobby.members) do
					if tostring(m.userId) ~= uid then
						o[#o + 1] = m
					end
				end
				return o
			end)()
			if rec.lobby.hostUserId == uid then
				local nh = rec.lobby.members[1]
				rec.lobby.hostUserId = nh and tostring(nh.userId) or rec.lobby.hostUserId
				for _, m in ipairs(rec.lobby.members) do
					m.isHost = m.userId == rec.lobby.hostUserId
				end
			end
			saveRecord(rec)
			broadcast(rec.lobby.id)
		end
		playerLobby[uid] = nil
		return { kind = "state", state = { user = { id = uid, username = player.Name }, lobby = nil } }
	elseif op == "heartbeat" then
		local rec = getRecord(payload.lobbyId or playerLobby[uid] or "")
		if rec then
			local m = isMember(rec, uid)
			if m then
				m.online = payload.online ~= false
				m.lastSeen = nowMs()
			end
		end
		return true
	elseif op == "listMyLobbies" then
		local out = {}
		for _, rec in pairs(lobbies) do
			if isMember(rec, uid) then
				out[#out + 1] = rec.lobby
			end
		end
		return out
	elseif op == "listPublicLobbies" then
		local out = {}
		for _, rec in pairs(lobbies) do
			if rec.lobby.settings.isPublic then
				out[#out + 1] = rec.lobby
			end
		end
		return out
	elseif op == "setReady" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		local set = {}
		for _, r in ipairs(rec.bundle.weekend.readyUserIds or {}) do
			set[r] = true
		end
		if payload.ready then
			set[uid] = true
		else
			set[uid] = nil
		end
		local arr = {}
		for k in pairs(set) do
			arr[#arr + 1] = k
		end
		rec.bundle.weekend.readyUserIds = arr
		saveRecord(rec)
		broadcast(rec.lobby.id)
		return { kind = "state", state = stateForPlayer(player, rec) }
	elseif op == "sendChat" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		local body = tostring(payload.body or ""):sub(1, 500)
		if body ~= "" then
			rec.chat[#rec.chat + 1] = {
				id = newId("msg"),
				lobbyId = rec.lobby.id,
				userId = uid,
				username = player.Name,
				body = body,
				createdAt = nowMs(),
			}
			if #rec.chat > 200 then
				table.remove(rec.chat, 1)
			end
			persist("lobby:" .. rec.lobby.id, rec)
			broadcast(rec.lobby.id)
		end
		return rec.chat
	elseif op == "applyAction" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		local action = payload.action
		local ctx = {
			userId = uid,
			lobbyId = rec.lobby.id,
			hostUserId = rec.lobby.hostUserId,
			memberTeamId = memberTeamId(rec, uid),
			isMember = isMember(rec, uid) ~= nil,
		}
		local bundle, extra, sideEffect = CareerOps.apply(rec.bundle, ctx, action)
		rec.bundle = bundle
		if sideEffect and sideEffect.memberTeamId then
			local m = isMember(rec, uid)
			if m then
				m.teamId = sideEffect.memberTeamId
			end
		end
		saveRecord(rec)
		broadcast(rec.lobby.id)
		return { extra = extra, state = stateForPlayer(player, rec) }
	elseif op == "negotiate" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		local ctx = {
			userId = uid,
			lobbyId = rec.lobby.id,
			hostUserId = rec.lobby.hostUserId,
			memberTeamId = memberTeamId(rec, uid),
			isMember = isMember(rec, uid) ~= nil,
		}
		local result = CareerOps.negotiate(rec.bundle, ctx, payload.driverId, payload.teamId, payload.offer)
		return result
	elseif op == "startLive" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can start the race.")
		end
		if rec.bundle.weekend.resultId then
			for _, r in ipairs(rec.bundle.results) do
				if r.id == rec.bundle.weekend.resultId then
					return { result = r, state = stateForPlayer(player, rec) }
				end
			end
		end
		if rec.live then
			return { state = stateForPlayer(player, rec), live = liveMessage(rec, "beat") }
		end
		local ready = {}
		for _, r in ipairs(rec.bundle.weekend.readyUserIds or {}) do
			ready[r] = true
		end
		local notReady = {}
		for _, m in ipairs(rec.lobby.members) do
			if m.online and not ready[tostring(m.userId)] then
				notReady[#notReady + 1] = m.username
			end
		end
		if #notReady > 0 then
			error("Cannot start: " .. table.concat(notReady, ", ") .. " not ready.")
		end
		local prep = Season.prepareRace(rec.bundle)
		local controlled = {}
		for _, m in ipairs(rec.lobby.members) do
			if m.teamId then
				for _, d in ipairs(rec.bundle.drivers) do
					if d.teamId == m.teamId and not d.isReserve then
						controlled[#controlled + 1] = d.id
					end
				end
			end
		end
		local engine = LiveRace.new({
			raceId = prep.raceId,
			seed = prep.seed,
			circuit = prep.circuit,
			totalLaps = prep.totalLaps,
			ruleset = prep.ruleset,
			weatherStart = prep.weatherStart,
			entrants = prep.entrants,
			severitySetting = rec.bundle.settings.incidentSeverity,
			controlledDriverIds = controlled,
			qualifying = prep.qualifying,
			poleDriverId = prep.poleDriverId,
		})
		rec.live = { engine = engine, speed = 1, paused = false, seq = 0 }
		task.spawn(liveLoop, rec)
		broadcastLive(rec, "start")
		return {
			state = stateForPlayer(player, rec),
			live = liveMessage(rec, "start"),
		}
	elseif op == "liveState" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec or not isMember(rec, uid) then
			return { live = { kind = "live", t = "idle" }, state = stateForPlayer(player, rec) }
		end
		return { live = liveMessage(rec, rec.live and "beat" or "idle"), state = stateForPlayer(player, rec) }
	elseif op == "liveCommand" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		if not rec.live then
			error("No live race in progress.")
		end
		local teamId = memberTeamId(rec, uid)
		if not teamId then
			error("You are not running a team in this lobby.")
		end
		local driverId = payload.driverId
		local owns = false
		for _, d in ipairs(rec.bundle.drivers) do
			if d.id == driverId and d.teamId == teamId then
				owns = true
				break
			end
		end
		if not owns then
			error("You can only command your own drivers.")
		end
		local raw = payload.patch or {}
		local patch = {}
		if raw.pace == "conserve" or raw.pace == "normal" or raw.pace == "push" then
			patch.pace = raw.pace
		end
		if raw.pitRequest ~= nil then
			patch.pitRequest = raw.pitRequest and true or false
		end
		if raw.pitCompound == "soft" or raw.pitCompound == "medium" or raw.pitCompound == "hard" then
			patch.pitCompound = raw.pitCompound
		end
		if raw.clearPit then
			patch.pitRequest = false
		end
		local ev = rec.live.engine:setCommand(driverId, patch)
		if ev then
			rec.live.seq += 1
		end
		sendLive(rec, liveMessage(rec, "beat"))
		return { live = liveMessage(rec, "beat"), event = ev }
	elseif op == "livePause" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec or not rec.live then
			error("No live race in progress.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can pause the race.")
		end
		rec.live.paused = payload.paused and true or false
		sendLive(rec, liveMessage(rec, "beat"))
		return { live = liveMessage(rec, "beat") }
	elseif op == "liveSpeed" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec or not rec.live then
			error("No live race in progress.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can change the live speed.")
		end
		local speed = math.floor(tonumber(payload.speed) or 1)
		rec.live.speed = math.clamp(speed, 1, 4)
		sendLive(rec, liveMessage(rec, "beat"))
		return { live = liveMessage(rec, "beat") }
	elseif op == "liveSkip" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec or not rec.live then
			error("No live race in progress.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can skip the race.")
		end
		local result = finishLive(rec)
		return { result = result, state = stateForPlayer(player, rec) }
	elseif op == "liveAbort" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can abort the race.")
		end
		rec.live = nil
		sendLive(rec, { kind = "live", t = "abort" })
		return { state = stateForPlayer(player, rec) }
	elseif op == "startRace" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can start the race.")
		end
		if rec.bundle.weekend.resultId then
			for _, r in ipairs(rec.bundle.results) do
				if r.id == rec.bundle.weekend.resultId then
					return { result = r, state = stateForPlayer(player, rec) }
				end
			end
		end
		local ready = {}
		for _, r in ipairs(rec.bundle.weekend.readyUserIds or {}) do
			ready[r] = true
		end
		local notReady = {}
		for _, m in ipairs(rec.lobby.members) do
			if m.online and not ready[tostring(m.userId)] then
				notReady[#notReady + 1] = m.username
			end
		end
		if #notReady > 0 then
			error("Cannot start: " .. table.concat(notReady, ", ") .. " not ready.")
		end
		local res = Season.runRaceWeekend(rec.bundle)
		rec.bundle = res.bundle
		saveRecord(rec)
		broadcast(rec.lobby.id)
		return { result = res.result, state = stateForPlayer(player, rec) }
	elseif op == "commitRace" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can submit the race result.")
		end
		if rec.bundle.weekend.resultId then
			for _, r in ipairs(rec.bundle.results) do
				if r.id == rec.bundle.weekend.resultId then
					return { result = r, state = stateForPlayer(player, rec) }
				end
			end
		end
		local result = payload.result
		local driverIds, teamIds = {}, {}
		for _, d in ipairs(rec.bundle.drivers) do
			driverIds[d.id] = true
		end
		for _, t in ipairs(rec.bundle.teams) do
			teamIds[t.id] = true
		end
		local classification = {}
		for _, c in ipairs(result.classification or {}) do
			if driverIds[c.driverId] and teamIds[c.teamId] then
				classification[#classification + 1] = c
			end
		end
		if #classification < 2 then
			error("Race result is incomplete.")
		end
		local safe = {
			id = rec.bundle.career.id .. ":s" .. rec.bundle.season.number .. ":r" .. rec.bundle.weekend.raceIndex,
			careerId = rec.bundle.career.id,
			season = rec.bundle.season.number,
			raceIndex = rec.bundle.weekend.raceIndex,
			processed = false,
			qualifying = result.qualifying or {},
			classification = classification,
			laps = result.laps or {},
			weather = result.weather,
			fastestLapDriverId = result.fastestLapDriverId,
			notes = result.notes,
		}
		local res = Season.commitRaceResult(rec.bundle, safe)
		rec.bundle = res.bundle
		saveRecord(rec)
		broadcast(rec.lobby.id)
		return { result = res.result, state = stateForPlayer(player, rec) }
	elseif op == "transferHost" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can transfer host privileges.")
		end
		rec.lobby.hostUserId = tostring(payload.toUserId)
		for _, m in ipairs(rec.lobby.members) do
			m.isHost = tostring(m.userId) == rec.lobby.hostUserId
		end
		saveRecord(rec)
		broadcast(rec.lobby.id)
		return { kind = "state", state = stateForPlayer(player, rec) }
	elseif op == "removeMember" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can remove members.")
		end
		local target = tostring(payload.memberUserId)
		local out = {}
		for _, m in ipairs(rec.lobby.members) do
			if tostring(m.userId) ~= target then
				out[#out + 1] = m
			end
		end
		rec.lobby.members = out
		playerLobby[target] = nil
		saveRecord(rec)
		broadcast(rec.lobby.id)
		return { kind = "state", state = stateForPlayer(player, rec) }
	elseif op == "setPaused" then
		local rec = getRecord(playerLobby[uid] or "")
		if not rec then
			error("No active lobby.")
		end
		if rec.lobby.hostUserId ~= uid then
			error("Only the host can pause the career.")
		end
		rec.lobby.paused = payload.paused and true or false
		saveRecord(rec)
		broadcast(rec.lobby.id)
		return { kind = "state", state = stateForPlayer(player, rec) }
	end
	error("Unknown operation: " .. tostring(op))
end

api.OnServerInvoke = function(player, op, payload)
	local uid = tostring(player.UserId)
	local ok, res = pcall(handle, player, uid, op, payload or {})
	if ok then
		return { ok = true, data = res }
	end
	return { ok = false, error = tostring(res) }
end

-- ---- live race relay -------------------------------------------------------

liveEvent.OnServerEvent:Connect(function(player, lobbyId, message)
	local uid = tostring(player.UserId)
	local rec = getRecord(lobbyId or playerLobby[uid] or "")
	if not rec or not isMember(rec, uid) then
		return
	end
	for _, m in ipairs(rec.lobby.members) do
		local other = playerFromUserId(m.userId)
		if other and other ~= player then
			liveEvent:FireClient(other, message, uid)
		end
	end
end)

-- ---- player lifecycle ------------------------------------------------------

local function onPlayerAdded(player)
	local uid = tostring(player.UserId)
	local id = fetch("user:" .. uid)
	if id then
		local rec = getRecord(id)
		if rec and isMember(rec, uid) then
			playerLobby[uid] = id
			local m = isMember(rec, uid)
			m.online = true
			m.lastSeen = nowMs()
			saveRecord(rec)
			task.defer(function()
				if player.Parent then
					lobbyEvent:FireClient(player, { kind = "state", state = stateForPlayer(player, rec) })
				end
			end)
		end
	end
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, p in ipairs(Players:GetPlayers()) do
	task.spawn(onPlayerAdded, p)
end

Players.PlayerRemoving:Connect(function(player)
	local uid = tostring(player.UserId)
	local id = playerLobby[uid]
	if not id then
		return
	end
	local rec = getRecord(id)
	if rec then
		local m = isMember(rec, uid)
		if m then
			m.online = false
			m.lastSeen = nowMs()
		end
		saveRecord(rec)
		broadcast(rec.lobby.id)
	end
end)

GameServer.api = api
GameServer.lobbyEvent = lobbyEvent
GameServer.liveEvent = liveEvent
GameServer.handle = handle

return GameServer
