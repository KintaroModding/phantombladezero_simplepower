# Simple Power

The player's hits deal more health damage and more Sha-Chi damage, the player's parries more Sha-Chi damage: one multiplier for each, x1.5 by default, 0.1 to 10. Enemies are not changed. A PBZModLoader mod; settings in a text file in its folder, or on its Mods Menu page.

A [PBZModLoader](https://github.com/KintaroModding/phantombladezero_pbzmodloader) mod for Phantom Blade Zero (Unreal Engine
5.7), made with game version `CL-302256_JKS-17280` and PBZModLoader 2.1.0. This README is for developers.
What the mod does, how to install it and its compatibility are in [openmods.md](openmods.md), the mod page on
[openmods](https://openmods.nexus).

## How it works

The game runs much of its logic in JavaScript (Puerts). PBZModLoader loads every folder in
`ProjectPBZ/PBZModLoader/mods/` that has a `main.js`, through the game's own module system, after the game's
`MainStart`; `require("ue")`, `require("puerts")` and `require("Library/TsHelper")` are the game's modules, and
`puerts.argv.getByName("GameInstance")` gives the game instance. Before a reload (Alt+F5) the loader awaits the mod's
`stop()`, which must give back everything the mod changed.

`src/phantombladezero_simplepower/main.js` raises three attributes of the player character (`UBasicAttributeSet`):
`Attack` (health damage), `ShachiAttack` (the Sha-Chi damage of hits) and `Amplification_ReflectShachi` (the Sha-Chi
damage of parries, a share on top: 0.5 = 50% more). Every 500 ms it looks at
`GameplayStatics.GetPlayerCharacter` and its ability system:

- **The effects:** the game has a ready-made gameplay effect per attribute and operation,
  `/PBZCombatAsset/Config/AttributesModifyEffect/GE_MA_<attribute>_<0|1>_<operation>` (0 = `HasDuration`, 1 = instant).
  The mod uses `GE_MA_Attack_0_Mul`, `GE_MA_ShachiAttack_0_Mul` (one modifier, `Multiplicitive`) and
  `GE_MA_Amplification_ReflectShachi_0_Add` (one modifier, `Additive`, the multiplier minus 1): `HasDuration`,
  SetByCaller magnitude `AttributeOpMagnitude`. It builds the spec (`MakeSpecHandle`, `AssignSetByCallerMagnitude`,
  `SetDuration` 1,000,000 s) and applies it with `BP_ApplyGameplayEffectSpecToSelf`, as Faster Movement does for the
  speeds. `AttributeUtils.AddAttributeBuff` is not used: it ran as an instant effect in game.
- **Parries:** the game takes a share of the enemy's Sha-Chi bar there (a perfect parry twice an imperfect one, after
  which the player loses Sha-Chi too), and `ShachiAttack` does not count: measured at x1.5 and x10, the same parry took
  the same amount. A held block took nothing from the enemy. The game's own Sha-Chi
  accessory (`GE_Accessory_ShachiAttack_Lv1`, `_Lv2`) adds to `Amplification_ReflectShachi`, so the mod does the same.
- **Only the current value:** a timed effect leaves the base value alone, so nothing of it reaches the save. Should an
  effect ever land on the base value, the mod puts the base back, warns and ends for the session.
- **One effect per attribute:** the handles are kept per character path name. An effect that is no longer active (death,
  load) is put on again; a changed multiplier takes the old effect off first; a multiplier of 1 has no effect at all. An
  effect that cannot be taken off blocks the new one, so the multipliers never stack.
- **Give back:** `Enable=Off` and `stop()` take all effects off. A poll that throws is tried again; 10 in a row (a
  class or asset is gone after a game update) end the mod for the session with one warning.
- **Stacking with other effects:** the engine adds up multipliers of the same operation on one attribute (x1.5 and x1.3
  give x1.8); a changed base value (a level, Phantom Tuner) multiplies.

- **Settings file:** `phantombladezero_simplepower.txt` next to `main.js` (`__dirname`, the mod's folder as a full path), read every
  2 s with `EasyCsv.LoadStringFromLocalFile` and written with the defaults when missing. The shipped file is exactly the
  script's default text (`tests/test_mod.js` checks it).
- **Mods Menu, optional:** PBZModLoader starts its mods after Mods Menu's, so a running Mods Menu (0.9.0 or later) has
  its registry object in `globalThis.PBZModsMenu` by then. Only when it has the features `settingsPath` and
  `store.saved`, the mod pushes its page (id `phantombladezero_simplepower`, `store: "saved"`) and reads the file the page saves
  (`PBZModsMenu.settingsPath(id)`, in Mods Menu's Saved folder): a registered page cannot save anywhere else.
- **Log:** a line per effect with the value before and after (`Attack x1.5: Attack 100 -> 150`), at most 30 per start.
  `console.log` lines that start with `[PBZMOD]` and the game's warnings reach `ProjectPBZ/PBZModLoader/loader.log`.

## Check and deploy

Requirements: Windows PowerShell 5.1 and [Node.js](https://nodejs.org/) (for `node --check` and the offline test).

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1             # node --check, tests\test_mod.js
powershell -ExecutionPolicy Bypass -File .\build.ps1 -Deploy     # the checks, then deploy.ps1
powershell -ExecutionPolicy Bypass -File .\deploy.ps1            # copy src\phantombladezero_simplepower to the game
```

`deploy.ps1` mirrors `src\phantombladezero_simplepower\` to `<game folder>\ProjectPBZ\PBZModLoader\mods\phantombladezero_simplepower\`. The
settings file that is already there is the tester's and stays; `-ResetConfig` copies the shipped one. The game folder
comes from `gameDir` in `_tools\gamedata\phantombladezero\game.json`, else `$env:UE5_GAMES_DIR\PBZ`; `-GameDir` or
`-ModsDir` override it. It stops when PBZModLoader is not installed (its start file
`ProjectPBZ\Content\JavaScript\PBZModLoader\bootstrap.js` is missing).

The GitHub release zip holds the mod folder at `ProjectPBZ/PBZModLoader/mods/phantombladezero_simplepower/`, so players unpack it
into the game folder.

Versioning: every change raises the second number in `mod.json` and `main.js` (1.0 -> 1.1): `python scripts\bump_version.py`.

## Project layout

```
src/phantombladezero_simplepower/   The mod folder: main.js and the shipped settings file
tests/test_mod.js     Offline test of main.js (Node.js, stand-ins for the game)
docs/                 Cover and screenshots
scripts/              bump_version.py, check_openmods.py, publish.ps1
build.ps1, deploy.ps1 Checks; copy into the game
mod.json              Name, version, game, kind pbzmodloader, modsPath
```

## License

MIT, see [LICENSE](LICENSE).
