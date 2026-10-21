-- Client state: wraps the Api RemoteFunction, tracks lobby/bundle, and emits
-- changed events so screens can re-render. Mirrors src/state/session.tsx.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local net = ReplicatedStorage:WaitForChild("F1Game"):WaitForChild("Net")
local Api = net:WaitForChild("Api")
local LobbyEvent = net:WaitForChild("LobbyEvent")
local LiveEvent = net:WaitForChild("LiveEvent")

local State = {}
State.user = nil
State.lobby = nil
State.bundle = nil
State.chat = {}
State.isHost = false
State.myTeamId = nil
State.loading = true
State.error = nil
State.live = nil

local changedEvent = Instance.new("BindableEvent")
State.Changed = changedEvent.Event

local function notify()
	changedEvent:Fire()
end
State.notify = notify

local function call(op, payload)
	local ok, res = pcall(function()
		return Api:InvokeServer(op, payload or {})
	end)
	if not ok then
		return nil, tostring(res)
	end
	if type(res) ~= "table" then
		return nil, "Bad response"
	end
	if not res.ok then
		return nil, res.error or "Request failed"
	end
	return res.data, nil
end
State.call = call

local function applyState(st)
	if not st then
		return
	end
	State.user = st.user or State.user
	State.lobby = st.lobby
	State.bundle = st.bundle
	if st.chat then
		State.chat = st.chat
	end
	State.isHost = st.isHost and true or false
	State.myTeamId = st.myTeamId
end
State.applyState = applyState

local function syncFrom(data)
	if type(data) == "table" then
		if data.state then
			applyState(data.state)
		elseif data.kind == "state" then
			applyState(data)
		end
	end
end

function State.refresh()
	local data, err = call("state", {})
	if err then
		State.error = err
	else
		syncFrom(data)
		State.error = nil
	end
	notify()
end

function State.createLobby(name, settings)
	local data, err = call("createLobby", { name = name, settings = settings or {} })
	if err then
		return nil, err
	end
	applyState(data.state)
	notify()
	return State.lobby, nil
end

function State.joinLobby(code)
	local data, err = call("joinLobby", { code = code })
	if err then
		return nil, err
	end
	applyState(data.state)
	notify()
	return State.lobby, nil
end

function State.openLobby(lobbyId)
	local data, err = call("openLobby", { lobbyId = lobbyId })
	if err then
		return nil, err
	end
	applyState(data.state)
	notify()
	return State.lobby, nil
end

function State.leaveLobby()
	call("leaveLobby", {})
	State.lobby = nil
	State.bundle = nil
	State.chat = {}
	State.myTeamId = nil
	notify()
end

function State.applyAction(action)
	local data, err = call("applyAction", { action = action })
	if err then
		return nil, err
	end
	syncFrom(data)
	notify()
	return data.extra, nil
end

function State.negotiate(driverId, teamId, offer)
	local data, err = call("negotiate", { driverId = driverId, teamId = teamId, offer = offer })
	if err then
		return nil, err
	end
	return data, nil
end

function State.startRace()
	local data, err = call("startRace", {})
	if err then
		return nil, err
	end
	syncFrom(data)
	notify()
	return data.result, nil
end

function State.commitRace(result)
	local data, err = call("commitRace", { result = result })
	if err then
		return nil, err
	end
	syncFrom(data)
	notify()
	return data and data.result, nil
end

function State.setReady(ready)
	local data, err = call("setReady", { ready = ready })
	if err then
		return nil, err
	end
	syncFrom(data)
	notify()
	return true, nil
end

local function applyLive(msg)
	if type(msg) ~= "table" or msg.kind ~= "live" then
		return false
	end
	if msg.t == "end" or msg.t == "abort" then
		State.live = nil
		if msg.t == "end" then
			State.refresh()
		else
			notify()
		end
		return true
	end
	if msg.t == "idle" then
		return true
	end
	State.live = {
		snapshot = msg.snapshot,
		events = msg.events or {},
		speed = msg.speed or 1,
		paused = msg.paused and true or false,
		seq = msg.seq or 0,
		t = msg.t,
	}
	notify()
	return true
end
State.applyLive = applyLive

function State.startLive()
	local data, err = call("startLive", {})
	if err then
		return nil, err
	end
	syncFrom(data)
	if data and data.result then
		State.live = nil
		notify()
		return data.result, nil, true
	end
	if data and data.live then
		applyLive(data.live)
	end
	notify()
	return State.live, nil
end

function State.liveState()
	local data, err = call("liveState", {})
	if err then
		return nil, err
	end
	syncFrom(data)
	if data and data.live then
		applyLive(data.live)
	end
	return State.live, nil
end

function State.liveCommand(driverId, patch)
	local data, err = call("liveCommand", { driverId = driverId, patch = patch })
	if err then
		return nil, err
	end
	if data and data.live then
		applyLive(data.live)
	end
	return data and data.event, nil
end

function State.livePause(paused)
	local data, err = call("livePause", { paused = paused })
	if err then
		return nil, err
	end
	if data and data.live then
		applyLive(data.live)
	end
	return true, nil
end

function State.liveSpeed(speed)
	local data, err = call("liveSpeed", { speed = speed })
	if err then
		return nil, err
	end
	if data and data.live then
		applyLive(data.live)
	end
	return true, nil
end

function State.liveSkip()
	local data, err = call("liveSkip", {})
	if err then
		return nil, err
	end
	syncFrom(data)
	State.live = nil
	notify()
	return data and data.result, nil
end

function State.liveAbort()
	local data, err = call("liveAbort", {})
	if err then
		return nil, err
	end
	syncFrom(data)
	State.live = nil
	notify()
	return true, nil
end

LiveEvent.OnClientEvent:Connect(function(msg)
	applyLive(msg)
end)

function State.sendChat(body)
	local data, err = call("sendChat", { body = body })
	if err then
		return nil, err
	end
	if type(data) == "table" then
		State.chat = data
	end
	notify()
	return true, nil
end

function State.setPaused(paused)
	local data, err = call("setPaused", { paused = paused })
	if err then
		return nil, err
	end
	syncFrom(data)
	notify()
	return true, nil
end

function State.transferHost(toUserId)
	local data, err = call("transferHost", { toUserId = toUserId })
	if err then
		return nil, err
	end
	syncFrom(data)
	notify()
	return true, nil
end

function State.removeMember(memberUserId)
	local data, err = call("removeMember", { memberUserId = memberUserId })
	if err then
		return nil, err
	end
	syncFrom(data)
	notify()
	return true, nil
end

LobbyEvent.OnClientEvent:Connect(function(msg)
	if type(msg) == "table" and msg.kind == "state" then
		applyState(msg.state)
		notify()
	end
end)

-- presence heartbeat
task.spawn(function()
	while true do
		task.wait(15)
		if State.lobby then
			call("heartbeat", { lobbyId = State.lobby.id, online = true })
		end
	end
end)

function State.listMyLobbies()
	local data, err = call("listMyLobbies", {})
	if err then
		return {}, err
	end
	return data or {}, nil
end

function State.listPublicLobbies()
	local data, err = call("listPublicLobbies", {})
	if err then
		return {}, err
	end
	return data or {}, nil
end

function State.init()
	State.loading = true
	State.refresh()
	State.loading = false
end

return State
