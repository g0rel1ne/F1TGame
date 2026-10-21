-- Staff data, auto-generated from src/data/staff.ts

local FIRST = { "Adrian", "Beatrice", "Carlos", "Delphine", "Eduardo", "Freya", "Gareth", "Helena", "Igor", "Julia", "Kwame", "Lorenzo", "Mira", "Nadia", "Otto", "Priya", "Quentin", "Rosa", "Stefan", "Tessa", "Umberto", "Valentina", "Willem", "Ximena", "Yusuf", "Zara", "Amara", "Boris", "Camille", "Dmitri" }

local LAST = { "Alvarez", "Bakker", "Costa", "Dubois", "Eriksen", "Fontaine", "Girard", "Hoffmann", "Ibarra", "Jensen", "Keller", "Lombardi", "Moreau", "Novak", "Okafor", "Petrov", "Quintero", "Ricci", "Schmidt", "Tanaka", "Ulrich", "Vargas", "Weber", "Yilmaz" }

local STAFF_ROLES = {
	{ role="technical-director", label="Technical Director", salaryBase=4500000, effect="Overall development speed" },
	{ role="chief-designer", label="Chief Designer", salaryBase=3600000, effect="Upgrade quality" },
	{ role="aero-chief", label="Aerodynamics Chief", salaryBase=3400000, effect="Aero research output" },
	{ role="race-engineer", label="Race Engineer", salaryBase=2200000, effect="Setup accuracy & strategy" },
	{ role="performance-engineer", label="Performance Engineer", salaryBase=1900000, effect="Qualifying pace extraction" },
	{ role="sporting-director", label="Sporting Director", salaryBase=2600000, effect="Penalty mitigation & morale" },
	{ role="chief-mechanic", label="Chief Mechanic", salaryBase=1800000, effect="Pit stop speed" },
	{ role="pit-crew", label="Pit Crew", salaryBase=1200000, effect="Pit stop consistency" },
	{ role="commercial-director", label="Commercial Director", salaryBase=2800000, effect="Sponsorship income" },
	{ role="scout", label="Scout", salaryBase=1100000, effect="Talent discovery" },
}

local CORE_ROLES = { "technical-director", "chief-designer", "aero-chief", "race-engineer", "performance-engineer", "sporting-director", "chief-mechanic", "pit-crew", "commercial-director", "scout" }

return { FIRST = FIRST, LAST = LAST, STAFF_ROLES = STAFF_ROLES, CORE_ROLES = CORE_ROLES }
