-- Client bootstrap. Routes between Home (no lobby), TeamWizard (no team) and the
-- career Shell.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local UiKit = require(script.Parent.UiKit)
local State = require(script.Parent.State)
local Shell = require(script.Parent.Shell)
local Home = require(script.Parent.Screens.Home)
local TeamWizard = require(script.Parent.Screens.TeamWizard)
local Config = require(ReplicatedStorage.F1Game.Shared.Config)
local CareerLib = require(ReplicatedStorage.F1Game.Shared.Career)
local Format = require(ReplicatedStorage.F1Game.Shared.Format)

local gui = Instance.new("ScreenGui")
gui.Name = "F1Game"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.DisplayOrder = 100
gui.Parent = playerGui
UiKit.toastHost(gui)

local root = UiKit.inst("Frame", {
	Name = "Root",
	BackgroundColor3 = Config.Colors.carbon950,
	BorderSizePixel = 0,
	Size = UDim2.new(1, 0, 1, 0),
}, gui)

local ctx = {
	state = State,
	ui = UiKit,
	C = UiKit.C,
	F = Format,
	Career = CareerLib,
	Config = Config,
	toast = UiKit.toast,
	screenGui = gui,
}

local function render()
	ctx.reroute = render
	if State.lobby and State.myTeamId then
		root.Visible = false
		Shell.mount(gui)
	else
		Shell.unmount()
		root.Visible = true
		UiKit.clear(root)
		if State.lobby then
			TeamWizard.render(ctx, root)
		else
			Home.render(ctx, root)
		end
	end
end

State.Changed:Connect(render)

State.init()
render()
